const { GoogleGenerativeAI } = require("@google/generative-ai");
const Redis = require("ioredis");
const { publishMessage } = require("../utils/redis/publisher");
require("dotenv").config();

// Get customer_id from command-line arguments
const customer_id = process.argv[2];

if (!customer_id) {
    console.error("❌ Error: No customer_id provided. Usage: node leadAgent.js <customer_id>");
    process.exit(1);
}

// Initialize Redis clients
const subscriberClient = new Redis(process.env.REDIS_URL);

// Initialize Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

// Process lead with AI
async function analyzeLead(lead) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        
        const prompt = `You are an expert business analyst with deep construction industry knowledge. Analyze this business lead email and extract ALL valuable business insights. Make intelligent inferences based on industry context and business patterns.

Think deeply and make informed inferences about:
1. What makes this lead unique or valuable?
2. What hidden opportunities or challenges might exist based on their situation?
3. What unstated needs can you infer from their industry, size, and request?
4. What potential pain points are typical for their type of business?
5. What makes this lead urgent or high priority?
   - Look for time-sensitive indicators
   - Identify competitive pressures
   - Assess potential business impact
   - Consider market opportunity size
6. What is the core essence of their request?
   - Main business objective
   - Key motivations
   - Primary pain points
   - Expected outcomes

IMPORTANT: Return ONLY a raw JSON object. Do not include any text like 'JSON' or code block markers.
When a category could have multiple items, always try to infer at least 2-3 reasonable possibilities based on industry knowledge.

Analyze this lead email:
Subject: ${lead.subject}
From: ${lead.sender}
Body: ${lead.body}

Remember: 
- Make intelligent inferences based on industry patterns
- Consider both explicit statements and implicit signals
- Use construction industry knowledge to identify likely needs and challenges
- Never leave arrays empty - always infer reasonable possibilities`;

        const response = await model.generateContent(prompt);
        const result = await response.response.text();
        
        // Clean the response - remove any markdown formatting or "JSON" prefix
        const cleanResult = result
            .replace(/```json\n|```|\n```/g, '')  // Remove code block markers
            .replace(/^JSON\s*\n?/, '')           // Remove "JSON" prefix
            .replace(/^\s*{\s*/, '{')             // Clean up leading whitespace
            .trim();
        
        try {
            // Parse and validate the AI response
            const leadAnalysis = JSON.parse(cleanResult);
            console.log(`✅ Lead analysis completed for email from ${lead.sender}`);
            return leadAnalysis;
        } catch (parseError) {
            console.error("❌ Error parsing AI response:", parseError);
            console.log("Raw AI response:", cleanResult);
            return null;
        }
    } catch (error) {
        console.error("❌ Error analyzing lead with AI:", error);
        return null;
    }
}

// Process incoming lead from Redis
async function processLead(lead) {
    console.log(`📨 Processing Lead from ${lead.sender}`);
    
    try {
        // Use AI to analyze the lead
        const leadAnalysis = await analyzeLead(lead);
        
        if (!leadAnalysis) {
            console.error("❌ Failed to analyze lead");
            return;
        }

        // Add metadata and remove any duplicate entries
        const enrichedLead = {
            original_email: lead,
            analysis: JSON.parse(JSON.stringify(leadAnalysis)), // Deep clone to clean up any duplicates
            timestamp: new Date().toISOString(),
            customer_id: customer_id
        };

        // Publish to scoring channel
        await publishMessage(`lead_scoring_channel_${customer_id}`, enrichedLead);
        console.log(`📢 Published message to lead_scoring_channel_${customer_id}:`, 
            JSON.stringify(enrichedLead, null, 2)); // Pretty print with indentation
        console.log(`✅ Lead published to scoring channel for ${lead.sender}`);
        
    } catch (error) {
        console.error("❌ Error processing lead:", error);
    }
}

// Subscribe to lead channel
async function subscribeToLeads() {
    try {
        console.log(`👂 Lead Agent subscribed to lead_channel_${customer_id}`);
        
        subscriberClient.subscribe(`lead_channel_${customer_id}`, (err) => {
            if (err) {
                console.error("❌ Error subscribing to lead channel:", err);
                process.exit(1);
            }
        });

        subscriberClient.on("message", async (channel, message) => {
            if (channel === `lead_channel_${customer_id}`) {
                const lead = JSON.parse(message);
                await processLead(lead);
            }
        });

    } catch (error) {
        console.error("❌ Error in lead subscription:", error);
        process.exit(1);
    }
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
    console.log('\n🔴 Shutting down lead agent...');
    await subscriberClient.quit();
    process.exit(0);
});

// Start the agent
subscribeToLeads();
