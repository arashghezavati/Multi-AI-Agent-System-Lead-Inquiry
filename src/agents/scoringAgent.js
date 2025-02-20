const { GoogleGenerativeAI } = require("@google/generative-ai");
const Redis = require("ioredis");
const { publishMessage } = require("../utils/redis/publisher");
require("dotenv").config();

// Get customer_id from command-line arguments
const customer_id = process.argv[2];

if (!customer_id) {
    console.error("❌ Error: No customer_id provided. Usage: node scoringAgent.js <customer_id>");
    process.exit(1);
}

// Initialize Redis clients
const subscriberClient = new Redis(process.env.REDIS_URL);

// Initialize Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

// Score lead with AI
async function scoreLead(leadData) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        
        const prompt = `As an expert in lead prioritization for the construction materials industry, analyze this lead and determine its priority to help our employees efficiently manage their responses. Your analysis will directly impact which leads our employees handle first.

You are scoring leads for a construction materials supplier where:
- Quick response time is crucial for customer satisfaction
- Angry or frustrated customers need immediate attention
- Large orders and multi-location deals are high value
- Existing customers with growth potential are important
- Emergency construction needs require rapid response

Consider ALL possible factors for scoring, including but not limited to:

1. Urgency Signals:
   - Direct mentions of deadlines or time constraints
   - Words indicating urgency ("immediately", "asap", "urgent", "emergency")
   - Project timeline dependencies
   - Competitive situations ("considering other suppliers")
   - Seasonal or weather-related constraints

2. Email Tone Analysis:
   - Signs of frustration or dissatisfaction
   - Emotional language or emphasis (ALL CAPS, multiple exclamation marks)
   - Previous follow-up attempts mentioned
   - Tone of urgency or desperation
   - Professional vs informal language

3. Business Value Indicators:
   - Order size hints
   - Multi-location opportunities
   - Long-term partnership potential
   - Cross-selling possibilities
   - Market expansion opportunities

4. Customer Context:
   - Existing vs new customer status
   - Past experiences mentioned
   - Industry reputation or company size
   - Previous order history references
   - Relationship strength signals

5. Risk Assessment:
   - Competitor mentions
   - Loss of business risks
   - Reputation impact
   - Market share implications
   - Strategic importance

Your analysis MUST use EXACTLY these category names:
- unique_value_propositions
- hidden_opportunities
- unstated_needs
- potential_risks
- urgency_factors

Score Categories (for employee prioritization):
- HOT LEAD (Priority 8-10): Requires immediate attention (same day)
  Examples: Angry customers, urgent needs, large immediate opportunities, risk of losing business
  
- WARM LEAD (Priority 5-7): Requires attention within 1-2 business days
  Examples: Growth opportunities, positive existing customers, non-urgent but valuable prospects
  
- COLD LEAD (Priority 1-4): Can be handled in regular queue (3+ business days)
  Examples: General inquiries, future possibilities, no clear timeline or urgency

Analyze this lead data and provide a detailed scoring analysis in JSON format:

${JSON.stringify(leadData, null, 2)}

Return in this STRUCTURE:
{
  "score": "HOT|WARM|COLD",
  "confidence": number (0-1),
  "reasons": string[],
  "recommended_actions": string[],
  "priority_level": number (1-10),
  "key_strengths": string[],
  "analysis_components": {
    "unique_value_propositions": [],
    "hidden_opportunities": [],
    "unstated_needs": [],
    "potential_risks": [],
    "urgency_factors": []
  },
  "follow_up_timeline": string,
  "tone_analysis": {
    "customer_sentiment": string,
    "urgency_indicators": string[],
    "emotional_signals": string[]
  },
  "response_priority": {
    "timeframe": string,
    "reason": string
  }
}`;

        const response = await model.generateContent(prompt);
        const result = await response.response.text();
        
        // Clean and parse the response
        const cleanResult = result
            .replace(/```json\n|```|\n```/g, '')
            .replace(/^JSON\s*\n?/, '')
            .replace(/^\s*{\s*/, '{')
            .trim();
        
        try {
            const scoreAnalysis = JSON.parse(cleanResult);
            console.log(`✅ Lead scoring completed for ${leadData.original_email.sender}`);
            return scoreAnalysis;
        } catch (parseError) {
            console.error("❌ Error parsing AI response:", parseError);
            console.log("Raw AI response:", cleanResult);
            return null;
        }
    } catch (error) {
        console.error("❌ Error scoring lead with AI:", error);
        return null;
    }
}

// Process incoming lead from Redis
async function processLead(lead) {
    console.log(`📊 Scoring Lead from ${lead.original_email.sender}`);
    
    try {
        // Use AI to score the lead
        const scoreAnalysis = await scoreLead(lead);
        
        if (!scoreAnalysis) {
            console.error("❌ Failed to score lead");
            return;
        }

        // Combine original lead data with score analysis
        const scoredLead = {
            ...lead,
            score_analysis: scoreAnalysis,
            scoring_timestamp: new Date().toISOString()
        };

        // Publish to qualified leads channel
        await publishMessage(`qualified_leads_channel_${customer_id}`, scoredLead);
        console.log(`📢 Published to qualified_leads_channel_${customer_id}:`, 
            JSON.stringify(scoredLead, null, 2));
        console.log(`✅ Lead qualified and published for ${lead.original_email.sender}`);
        
    } catch (error) {
        console.error("❌ Error processing lead:", error);
    }
}

// Subscribe to lead scoring channel
async function subscribeToLeads() {
    try {
        console.log(`👂 Scoring Agent subscribed to lead_scoring_channel_${customer_id}`);
        
        subscriberClient.subscribe(`lead_scoring_channel_${customer_id}`, (err) => {
            if (err) {
                console.error("❌ Error subscribing to lead scoring channel:", err);
                process.exit(1);
            }
        });

        subscriberClient.on("message", async (channel, message) => {
            if (channel === `lead_scoring_channel_${customer_id}`) {
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
    console.log('\n🔴 Shutting down scoring agent...');
    await subscriberClient.quit();
    process.exit(0);
});

// Start the agent
subscribeToLeads();
