const path = require("path");
const { google } = require("googleapis");
const { MongoClient } = require("mongodb");
const cheerio = require("cheerio");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { publishMessage } = require("../utils/redis/publisher");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// Get customer_id from command-line arguments
const customer_id = process.argv[2];

if (!customer_id) {
    console.error("❌ Error: No customer_id provided. Usage: node emailAgent.js <customer_id>");
    process.exit(1);
}

const mongoClient = new MongoClient(process.env.MONGODB_URI);

// Initialize Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

// Fetch customer credentials from MongoDB
async function getCustomerCredentials(customer_id) {
    try {
        await mongoClient.connect();
        const db = mongoClient.db();
        const customerConfig = await db.collection("customers_config").findOne({ customer_id });

        if (!customerConfig || !customerConfig.credentials || !customerConfig.credentials.gmail) {
            throw new Error(`❌ No Gmail credentials found for customer ${customer_id}`);
        }

        return customerConfig.credentials.gmail;
    } catch (error) {
        console.error("❌ Error fetching credentials:", error);
        process.exit(1);
    }
}

// Authenticate Gmail API using customer credentials
async function authenticateGmail() {
    const { client_id, client_secret, refresh_token } = await getCustomerCredentials(customer_id);

    const auth = new google.auth.OAuth2(
        client_id,
        client_secret,
        process.env.GOOGLE_REDIRECT_URI
    );
    auth.setCredentials({ refresh_token });

    return google.gmail({ version: "v1", auth });
}

// Extract email content and determine type using AI
function parseEmail(data) {
    const headers = data.payload.headers;
    const sender = headers.find(header => header.name === "From")?.value || "Unknown";
    const subject = headers.find(header => header.name === "Subject")?.value || "No Subject";
    const body = extractBody(data);

    return { sender, subject, body };
}

// Use Gemini AI to classify email type
async function classifyEmailType(email) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        
        const prompt = `Analyze this email and determine if it's a business inquiry or a sales lead.

An inquiry typically:
- Asks about specific product details, prices, or availability
- Focuses on immediate or short-term needs
- Requests information about a single transaction
- Asks about delivery times or shipping costs
- Wants to know about product specifications
- Asks about current stock levels

A lead could be any of these scenarios:
1. Business Relationship Interest:
   - Wanting to become a distributor or reseller
   - Discussing partnership opportunities
   - Mentioning multiple locations or branches
   - Interest in long-term collaboration

2. Special Requirements or Custom Needs:
   - Asking about customization possibilities
   - Requesting special product modifications
   - Inquiring about bulk or wholesale arrangements
   - Discussing specific industry requirements

3. Strategic Discussions:
   - Mentioning market expansion plans
   - Discussing exclusive territory rights
   - Interest in white-labeling or co-branding
   - Exploring joint venture possibilities

4. High-Value Potential:
   - Discussing annual supply contracts
   - Mentioning large-scale projects
   - Interest in becoming preferred supplier
   - Regular bulk purchase possibilities

5. Consultative Requests:
   - Seeking technical expertise or consultation
   - Asking about integration possibilities
   - Requesting product training or support
   - Interest in industry-specific solutions

6. Complex Requirements:
   - Multiple product lines interest
   - Supply chain integration discussions
   - Vendor qualification inquiries
   - Quality assurance requirements

Please analyze the following email and respond with ONLY "inquiry" or "lead":

Subject: ${email.subject}
Body: ${email.body}`;

        const response = await model.generateContent(prompt);
        const result = await response.response.text();
        
        // Clean and validate the response
        const type = result.trim().toLowerCase();
        return type === 'lead' ? 'lead' : 'inquiry'; // Default to inquiry if response is unclear
    } catch (error) {
        console.error("❌ Error classifying email with AI:", error);
        return 'inquiry'; // Default to inquiry on error
    }
}

// Fetch unread emails (only from the primary inbox)
async function fetchUnreadEmails() {
    const gmail = await authenticateGmail();

    try {
        const res = await gmail.users.messages.list({
            userId: "me",
            q: "is:unread category:primary",
            maxResults: 5,
        });

        if (!res.data.messages) {
            console.log("📭 No unread emails found.");
            return;
        }

        for (const message of res.data.messages) {
            const emailData = await gmail.users.messages.get({
                userId: "me",
                id: message.id,
            });

            const email = parseEmail(emailData.data);
            
            // Use AI to classify the email type
            const type = await classifyEmailType(email);
            email.type = type;
            
            console.log(`📩 Customer ${customer_id} - Fetched Email Type: ${type}`, email);

            // Publish to appropriate channel based on type
            const channel = type === 'lead' 
                ? `lead_channel_${customer_id}`
                : `email_channel_${customer_id}`;
            
            await publishMessage(channel, email);

            // Mark email as read
            await gmail.users.messages.modify({
                userId: "me",
                id: message.id,
                resource: { removeLabelIds: ["UNREAD"] },
            });

            console.log(`✅ Customer ${customer_id} - ${type.toUpperCase()} processed and marked as read.`);
        }
    } catch (error) {
        console.error(`❌ Customer ${customer_id} - Error fetching emails:`, error.message);
    }
}

// Extract and clean email body
function extractBody(data) {
    let body = "";

    if (!data.payload.parts) {
        body = data.payload.body.data
            ? Buffer.from(data.payload.body.data, "base64").toString()
            : "No Content";
    } else {
        for (const part of data.payload.parts) {
            if (part.mimeType === "text/plain" && part.body.data) {
                body = Buffer.from(part.body.data, "base64").toString();
                break;
            } else if (part.mimeType === "text/html" && part.body.data) {
                body = Buffer.from(part.body.data, "base64").toString();
                body = cleanHTML(body);
                break;
            }
        }
    }

    return body || "No Content";
}

// Clean HTML content
function cleanHTML(html) {
    const $ = cheerio.load(html);
    $("a").replaceWith(function () {
        return $(this).text();
    });

    let text = $("body").text().replace(/\s+/g, " ").trim();
    text = text.replace(/Unsubscribe.*$/i, "").replace(/Copyright.*$/i, "");

    return text;
}

// Start Email Agent (Runs every 60 seconds)
async function startEmailAgent() {
    console.log(`🚀 Email Agent for customer ${customer_id} is running...`);
    setInterval(fetchUnreadEmails, 60000);
}

startEmailAgent();
