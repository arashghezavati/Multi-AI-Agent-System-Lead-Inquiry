const Redis = require("redis");
const { google } = require('googleapis');
const { MongoClient } = require('mongodb');
require("dotenv").config();

class ResponseAgent {
    constructor() {
        this.name = 'ResponseAgent';
        this.subscriberClient = null;
        this.publisherClient = null;
        this.oauth2Client = null;
        this.gmail = null;
        this.customer_id = null;
        this.mongoClient = null;
    }

    async init() {
        // Get customer_id from command-line arguments
        this.customer_id = process.argv[2];

        if (!this.customer_id) {
            console.error("[ResponseAgent] ❌ Error: No customer_id provided. Usage: node responseAgent.js <customer_id>");
            process.exit(1);
        }

        // Initialize Redis clients
        this.subscriberClient = Redis.createClient({ url: process.env.REDIS_URL });
        this.publisherClient = Redis.createClient({ url: process.env.REDIS_URL });

        // Connect Redis
        try {
            await this.subscriberClient.connect();
            await this.publisherClient.connect();
            console.log('[ResponseAgent] ✅ Redis clients connected successfully');
        } catch (error) {
            console.error('[ResponseAgent] ❌ Redis connection error:', error);
            process.exit(1);
        }

        // Connect to MongoDB and get Gmail credentials
        try {
            this.mongoClient = new MongoClient(process.env.MONGODB_URI);
            await this.mongoClient.connect();
            console.log('[ResponseAgent] ✅ MongoDB connected successfully');

            const db = this.mongoClient.db('multi_ai_system');
            console.log(`[ResponseAgent] 🔍 Looking for customer config with id: ${this.customer_id}`);
            const customerConfig = await db.collection('customers_config').findOne(
                { customer_id: this.customer_id }
            );
            console.log('[ResponseAgent] 📄 Found customer config:', this.maskSensitiveData(customerConfig));

            if (!customerConfig || !customerConfig.credentials || !customerConfig.credentials.gmail) {
                throw new Error('Gmail configuration not found for customer');
            }

            // Configure Gmail API with credentials from MongoDB
            this.oauth2Client = new google.auth.OAuth2(
                customerConfig.credentials.gmail.client_id,
                customerConfig.credentials.gmail.client_secret,
                'http://localhost'  // Default redirect URI
            );

            this.oauth2Client.setCredentials({
                refresh_token: customerConfig.credentials.gmail.refresh_token
            });

            this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
            console.log('[ResponseAgent] ✅ Gmail API configured successfully');
        } catch (error) {
            console.error('[ResponseAgent] ❌ MongoDB/Gmail configuration error:', error);
            process.exit(1);
        }
    }

    maskSensitiveData(obj) {
        const maskedObj = JSON.parse(JSON.stringify(obj));
        
        // Mask credentials
        if (maskedObj.credentials) {
            for (const key in maskedObj.credentials) {
                if (maskedObj.credentials[key]) {
                    maskedObj.credentials[key] = {
                        ...maskedObj.credentials[key],
                        client_id: '***masked***',
                        client_secret: '***masked***',
                        refresh_token: '***masked***'
                    };
                }
            }
        }

        // Mask connection strings
        if (maskedObj.data_sources) {
            for (const source in maskedObj.data_sources) {
                if (maskedObj.data_sources[source].connection_string) {
                    maskedObj.data_sources[source].connection_string = '***masked***';
                }
            }
        }

        return maskedObj;
    }

    async processDecision(message) {
        try {
            // Parse message if it's a string
            const data = typeof message === 'string' ? JSON.parse(message) : message;
            console.log('[ResponseAgent] 📨 Processing decision for', data.product_name);
            
            // Get the customer info from the decision context
            const { decision_result } = data;
            const { context } = decision_result;
            const { customer } = context;

            // Extract email from customer data
            const recipientEmail = customer?.email;
            if (!recipientEmail) {
                console.log('[ResponseAgent] ⚠️ Customer data:', customer);
                console.log('[ResponseAgent] ⚠️ Full context:', context);
                throw new Error('Recipient email not found in decision data');
            }

            const subject = `Order ${decision_result.status}: ${data.product_name}`;
            const body = this.generateEmailBody(data);
            
            await this.sendEmail(recipientEmail, subject, body);
            console.log('[ResponseAgent] ✅ Response email sent successfully');
        } catch (error) {
            console.error('[ResponseAgent] ❌ Error processing response:', error);
            throw error;
        }
    }

    async sendEmail(to, subject, body) {
        try {
            console.log('[ResponseAgent] 📧 Sending email to:', to);
            const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
            const messageParts = [
                'From: "Sales Team" <sales@example.com>',
                `To: ${to}`,
                'Content-Type: text/plain; charset=utf-8',
                'MIME-Version: 1.0',
                `Subject: ${utf8Subject}`,
                '',
                body
            ];
            const message = messageParts.join('\n');

            // The message needs to be encoded in base64url
            const encodedMessage = Buffer.from(message)
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            await this.gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: encodedMessage,
                },
            });
            console.log('[ResponseAgent] ✅ Email sent successfully');
        } catch (error) {
            console.error('[ResponseAgent] ❌ Error sending email:', error);
            throw error;
        }
    }

    generateEmailBody(data) {
        const { decision_result } = data;
        const { context } = decision_result;
        const { pricing, inventory, delivery, customer } = context;

        // Get customer name from context
        const customerName = customer?.name || customer?.company || 'Valued Customer';

        return `Dear ${customerName},

Thank you for your order of ${data.quantity} units of ${data.product_name}.

We are pleased to inform you that your order has been ${decision_result.status} with the following details:

Product: ${data.product_name}
Quantity: ${data.quantity}
Delivery Location: ${delivery.requested_location}
Shipping From: ${delivery.warehouse_location}
Delivery Date: ${data.delivery_date || 'To be confirmed'}

Pricing Details:
- Subtotal: $${pricing.subtotal}
- Shipping Cost: $${pricing.shipping_cost} (${delivery.shipping_type})
- Total Cost: $${pricing.total_cost}

${decision_result.reasoning.join('\n')}

If you have any questions, please don't hesitate to contact us.

Best regards,
Your Sales Team`;
    }

    // Subscribe to decision channel
    async subscribeToDecisions() {
        await this.subscriberClient.subscribe(
            `decision_channel_${this.customer_id}`,
            async (message) => {
                console.log(`[ResponseAgent] 📩 Received decision:`, message);
                await this.processDecision(message);
            }
        );

        console.log(`[ResponseAgent] ✅ Response Agent subscribed to decision_channel_${this.customer_id}`);
    }

    // Handle graceful shutdown
    async shutdown() {
        console.log('\n[ResponseAgent] 🔴 Shutting down Response Agent...');
        await this.subscriberClient.quit();
        await this.publisherClient.quit();
        if (this.mongoClient) {
            await this.mongoClient.close();
        }
        process.exit(0);
    }

    async start() {
        await this.init();
        await this.subscribeToDecisions();
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            await this.shutdown();
        });
        
        console.log(`[ResponseAgent] 🚀 Response Agent for customer ${this.customer_id} is running...`);
    }
}

// Create and start the agent
const agent = new ResponseAgent();
agent.start().catch(error => {
    console.error('[ResponseAgent] ❌ Failed to start Response Agent:', error);
    process.exit(1);
});
