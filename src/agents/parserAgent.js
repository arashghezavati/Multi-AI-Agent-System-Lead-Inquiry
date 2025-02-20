const { GoogleGenerativeAI } = require("@google/generative-ai");
const { MongoClient } = require("mongodb");
const Redis = require("redis");
const { publishMessage } = require("../utils/redis/publisher");
require("dotenv").config();

// Get customer_id from command-line arguments
const customer_id = process.argv[2];

if (!customer_id) {
    console.error("❌ Error: No customer_id provided. Usage: node parserAgent.js <customer_id>");
    process.exit(1);
}

// Initialize Redis clients - only need subscriber since we use shared publisher
const subscriberClient = Redis.createClient({ url: process.env.REDIS_URL });

// Initialize MongoDB
const mongoClient = new MongoClient(process.env.MONGODB_URI);

// Initialize Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

// Connect to Redis
(async () => {
    await subscriberClient.connect();
    console.log('✅ Redis client connected successfully');
})();

// Fetch business details from MongoDB
async function getBusinessDetails(customer_id) {
    try {
        await mongoClient.connect();
        const db = mongoClient.db();
        const customerConfig = await db.collection("customers_config").findOne({ customer_id });

        if (!customerConfig || !customerConfig.business_details) {
            throw new Error(`No business details found for customer ${customer_id}`);
        }

        return customerConfig.business_details;
    } catch (error) {
        console.error("❌ Error fetching business details:", error);
        process.exit(1);
    }
}

// Generate dynamic AI prompt
function generatePrompt(businessDetails) {
    return `
You are analyzing customer inquiries for a business.

**Business Overview:**  
${businessDetails.business_description}

**Common Inquiries:**  
${businessDetails.common_inquiries}

**Required Information for Processing:**  
${businessDetails.required_information}

**Customer Types:**  
${businessDetails.customer_types}

**Special Instructions:**  
${businessDetails.special_instructions}

**Task:**  
1. Carefully analyze the email content using ALL the business context sections provided above.
2. Use the Required Information for Processing as your guide for what data to extract.
3. Follow the patterns shown in Common Inquiries for categorization.
4. Consider the Customer Types when interpreting the inquiry.
5. Apply any Special Instructions in your analysis.

IMPORTANT: Return ONLY a valid JSON object with the following structure:
{
    "product_name": "extracted product name",
    "quantity": "extracted quantity",
    "delivery_date": "extracted delivery date",
    "delivery_location": "extracted location",
    "customer_name": "extracted customer name",
    "company_name": "extracted company name",
    "inquiry_type": "one of: product_inquiry, price_request, availability_check, custom_order"
}

Do not include any explanation or markdown formatting. Return only the JSON object.

**Email Content:**
`;
}

// Call Google Gemini AI
async function analyzeEmail(email, prompt) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const response = await model.generateContent(`${prompt}\n\nSubject: ${email.subject}\nBody: ${email.body}`);
        const result = await response.response.text();
        
        // Clean the response and ensure it's valid JSON
        let cleanResult = result.replace(/```json\n|\n```|```/g, '').trim();
        
        // If the response starts with "JSON", remove it
        cleanResult = cleanResult.replace(/^JSON\s*/, '');
        
        try {
            return JSON.parse(cleanResult);
        } catch (parseError) {
            console.error("❌ Error parsing AI response as JSON:", parseError);
            console.error("Raw AI response:", result);
            return null;
        }
    } catch (error) {
        console.error("❌ Error calling AI service:", error);
        return null;
    }
}

// Process incoming emails from Redis
async function processEmail(email) {
    try {
        console.log(`📨 Processing Email for ${customer_id}: ${email.subject}`);
        
        // Get business details for AI prompt
        const businessDetails = await getBusinessDetails(customer_id);
        const prompt = generatePrompt(businessDetails);
        
        // Parse email with AI
        const parsedData = await analyzeEmail(email, prompt);
        if (!parsedData) {
            console.error("❌ AI parsing failed, skipping email.");
            return;
        }
        
        // Extract sender info from email body
        const emailLines = email.body.split('\n').map(line => line.trim());
        const signatureStartIndex = emailLines.findIndex(line => 
            line.startsWith('Best regards') || 
            line.startsWith('Regards') || 
            line.startsWith('Thanks')
        );
        
        let senderName = email.sender.split('<')[0].trim(); // Default to email sender
        let companyName = '';
        
        if (signatureStartIndex !== -1 && signatureStartIndex + 1 < emailLines.length) {
            // Get the line after "Best regards" for sender name
            const potentialSenderName = emailLines[signatureStartIndex + 1];
            if (potentialSenderName && potentialSenderName.length > 0) {
                senderName = potentialSenderName;
            }
            
            // Get the line after sender name for company
            if (signatureStartIndex + 2 < emailLines.length) {
                const potentialCompanyName = emailLines[signatureStartIndex + 2];
                if (potentialCompanyName && potentialCompanyName.length > 0) {
                    companyName = potentialCompanyName;
                }
            }
        }
        
        // Add sender details to parsed data
        const finalData = {
            ...parsedData,
            sender_name: senderName,
            sender_email: email.sender.match(/<(.+)>/)?.[1] || email.sender,
            company_name: companyName
        };
        
        // Publish parsed data to Redis
        const channelName = `parsed_email_channel_${customer_id}`;
        console.log("✅ Parsed Data:", finalData);
        await publishMessage(channelName, finalData);
        console.log(`📢 Published parsed data to ${channelName}:`, finalData);
    } catch (error) {
        console.error("❌ Error processing email:", error.message);
    }
}

// Subscribe to the email channel
async function subscribeToEmails() {
    try {
        await subscriberClient.subscribe(`email_channel_${customer_id}`, async (message) => {
            const email = JSON.parse(message);
            console.log(`📩 Received Email from emailAgent.js:`, email);
            await processEmail(email);
        });
        console.log(`✅ Parser Agent subscribed to email_channel_${customer_id}`);
    } catch (error) {
        console.error("❌ Error subscribing to email channel:", error);
        process.exit(1);
    }
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
    console.log('\n🔴 Shutting down parser agent...');
    await subscriberClient.quit();
    await mongoClient.close();
    process.exit(0);
});

// Start the agent
subscribeToEmails();
