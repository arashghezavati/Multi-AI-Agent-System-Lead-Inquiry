const { GoogleGenerativeAI } = require("@google/generative-ai");
const Redis = require("ioredis");
const { google } = require("googleapis");
const { OAuth2 } = google.auth;
const { MongoClient } = require("mongodb");
require("dotenv").config();
const logger = require('../utils/logger');

// Get customer_id from command-line arguments
const customer_id = process.argv[2];

if (!customer_id) {
    console.error("❌ Error: No customer_id provided. Usage: node leadEmailNotificationAgent.js <customer_id>");
    process.exit(1);
}

// Initialize Redis client
const subscriberClient = new Redis(process.env.REDIS_URL);

// Function to get customer config from MongoDB
async function getCustomerConfig() {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    try {
        await mongoClient.connect();
        const db = mongoClient.db();
        const config = await db.collection("customers_config").findOne({ customer_id });
        return config;
    } catch (error) {
        logger.error(`Error getting customer config: ${error}`);
        throw error;
    } finally {
        await mongoClient.close();
    }
}

// Initialize Gmail API
async function initializeGmail(credentials) {
    try {
        const oauth2Client = new OAuth2(
            credentials.gmail.client_id,
            credentials.gmail.client_secret
        );
        
        oauth2Client.setCredentials({
            refresh_token: credentials.gmail.refresh_token
        });
        
        return google.gmail({ version: 'v1', auth: oauth2Client });
    } catch (error) {
        logger.error(`Error initializing Gmail API: ${error}`);
        throw error;
    }
}

// Data contract validation
const LEAD_DATA_CONTRACT = {
  required: {
    'original_email.sender': 'string',
    'score_analysis.score': 'string',
    'score_analysis.response_priority.timeframe': 'string'
  },
  optional: {
    'score_analysis.analysis_components.unique_value_propositions': 'array',
    'score_analysis.analysis_components.hidden_opportunities': 'array',
    'score_analysis.analysis_components.unstated_needs': 'array',
    'score_analysis.analysis_components.potential_risks': 'array',
    'score_analysis.analysis_components.urgency_factors': 'array'
  }
};

const validateDataContract = (data) => {
  // Validate required fields
  const missingFields = Object.entries(LEAD_DATA_CONTRACT.required)
    .filter(([path]) => !getNestedValue(data, path))
    .map(([path]) => path);

  if (missingFields.length > 0) {
    logger.error(`Missing required fields: ${missingFields.join(', ')}`);
    return false;
  }

  // Validate field types
  const typeErrors = Object.entries({
    ...LEAD_DATA_CONTRACT.required,
    ...LEAD_DATA_CONTRACT.optional
  }).filter(([path, type]) => {
    const value = getNestedValue(data, path);
    return value && typeof value !== type && !(Array.isArray(value) && type === 'array');
  });

  if (typeErrors.length > 0) {
    logger.error(`Type mismatches: ${typeErrors.map(([path, type]) => `${path} (expected ${type})`).join(', ')}`);
    return false;
  }

  return true;
};

// Helper function to safely access nested properties
const getNestedValue = (obj, path) => {
  return path.split('.').reduce((acc, part) => acc?.[part], obj);
};

// Format email content with proper null checks
function formatEmailContent(leadData) {
  if (!validateDataContract(leadData)) {
    return {
      subject: '⚠️ DATA VALIDATION FAILED - Manual Review Required',
      body: `Invalid lead data structure received:\n${JSON.stringify(leadData, null, 2)}`
    };
  }

  // Safe formatting with fallbacks
  const safeArray = (arr) => Array.isArray(arr) ? arr : [];
  const safeString = (str) => typeof str === 'string' ? str : 'Not available';

  const analysisComponents = leadData.score_analysis?.analysis_components || {};

  // Build email sections
  const sections = {
    uniqueValue: safeArray(analysisComponents.unique_value_propositions),
    hiddenOpportunities: safeArray(analysisComponents.hidden_opportunities),
    unstatedNeeds: safeArray(analysisComponents.unstated_needs),
    potentialRisks: safeArray(analysisComponents.potential_risks),
    urgencyFactors: safeArray(analysisComponents.urgency_factors)
  };

  // Format email body
  const body = `
Lead Priority: ${leadData.score_analysis?.score || 'UNKNOWN'}
Confidence: ${(leadData.score_analysis?.confidence * 100 || 0).toFixed(1)}%
Response Timeline: ${leadData.score_analysis?.response_priority?.timeframe || 'Not specified'}

Original Email:
From: ${leadData.original_email?.sender || 'Unknown'}
Subject: ${leadData.original_email?.subject || 'No subject'}

Key Opportunities:
${sections.hiddenOpportunities.map(o => `• ${o}`).join('\n') || '• No specific opportunities identified'}

Urgency Factors:
${sections.urgencyFactors.map(u => `• ${u}`).join('\n') || '• No urgent factors detected'}

Full Analysis:
${Object.entries(sections)
  .filter(([_, items]) => items.length > 0)
  .map(([name, items]) => `${name}:\n${items.map(i => `• ${i}`).join('\n')}`)
  .join('\n\n')}
`;

  return {
    subject: `[${leadData.score_analysis?.score || 'UNKNOWN'} LEAD] ${safeString(leadData.original_email?.subject)}`,
    body
  };
}

// Send email using Gmail API
async function sendEmail(gmail, config, subject, body) {
    try {
        const emailLines = [
            `To: ${config.notification_settings.gmail.sales_team_email}`,
            'Content-Type: text/plain; charset=utf-8',
            'MIME-Version: 1.0',
            `Subject: ${subject}`,
            '',
            body
        ];

        const email = emailLines.join('\r\n').trim();
        const base64Email = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: base64Email
            }
        });
        console.log(`✅ Notification email sent to ${config.notification_settings.gmail.sales_team_email}`);
    } catch (error) {
        logger.error(`Error sending email: ${error}`);
        throw error;
    }
}

// Process qualified lead
async function processQualifiedLead(lead, gmail, config) {
    try {
        console.log(`📨 Processing qualified lead from ${lead.original_email.sender}`);
        logger.info('Received lead data:', JSON.stringify(lead, null, 2));
        const validationResult = validateDataContract(lead);
        logger.info(`Data validation ${validationResult ? 'passed' : 'failed'}`);
        
        const { subject, body } = formatEmailContent(lead);
        await sendEmail(gmail, config, subject, body);
    } catch (error) {
        logger.error(`Error processing qualified lead: ${error}`);
        throw error;
    }
}

// Main function to start the agent
async function startAgent() {
    try {
        // Get customer configuration
        const config = await getCustomerConfig();
        if (!config) {
            throw new Error(`No configuration found for customer ${customer_id}`);
        }

        // Initialize Gmail API
        const gmail = await initializeGmail(config.credentials);
        console.log('✅ Gmail API initialized successfully');

        // Subscribe to qualified leads channel
        console.log(`👂 Lead Email Notification Agent subscribed to qualified_leads_channel_${customer_id}`);
        
        subscriberClient.subscribe(`qualified_leads_channel_${customer_id}`, (err) => {
            if (err) {
                logger.error(`Error subscribing to qualified leads channel: ${err}`);
                process.exit(1);
            }
        });

        // Listen for messages
        subscriberClient.on("message", async (channel, message) => {
            if (channel === `qualified_leads_channel_${customer_id}`) {
                try {
                    const lead = JSON.parse(message);
                    await processQualifiedLead(lead, gmail, config);
                } catch (error) {
                    logger.error(`Error processing message: ${error}`);
                }
            }
        });

    } catch (error) {
        logger.error(`Error starting Lead Email Notification Agent: ${error}`);
        process.exit(1);
    }
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
    console.log('\n🔴 Shutting down Lead Email Notification Agent...');
    await subscriberClient.quit();
    process.exit(0);
});

// Start the agent
startAgent();
