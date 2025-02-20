const Redis = require("redis");
const { publishMessage } = require("../utils/redis/publisher");
require("dotenv").config();

// Get customer_id from command-line arguments
const customer_id = process.argv[2];

if (!customer_id) {
    console.error("❌ Error: No customer_id provided. Usage: node decisionAgent.js <customer_id>");
    process.exit(1);
}

// Initialize Redis clients
const subscriberClient = Redis.createClient({ url: process.env.REDIS_URL });
const publisherClient = Redis.createClient({ url: process.env.REDIS_URL });

// Connect Redis
(async () => {
    try {
        await subscriberClient.connect();
        await publisherClient.connect();
        console.log('✅ Redis clients connected successfully');
        await subscribeToDecisionRequests();
    } catch (error) {
        console.error('❌ Redis connection error:', error);
        process.exit(1);
    }
})();

// Decision making logic
function makeDecision(data) {
    console.log('\n🤔 Making decision based on:');
    console.log('Received data:', JSON.stringify(maskSensitiveData(data), null, 2));

    const { 
        pricing_result,
        product_name,
        quantity: raw_quantity,
        inventory_status
    } = data;

    if (!pricing_result) {
        throw new Error('Missing pricing_result in input data');
    }

    console.log(`   Product: ${product_name}`);
    console.log(`   Requested Quantity: ${pricing_result.pricing_details.quantity}`);
    console.log(`   Available Quantity: ${inventory_status.quantity_available}`);
    console.log(`   Total Cost: $${pricing_result.total_cost}`);

    // Initialize decision object
    const decision = {
        status: 'PENDING',
        reasoning: [],
        alternatives: [],
        context: {
            pricing: pricing_result,
            inventory: inventory_status,
            delivery: pricing_result.pricing_details
        }
    };

    // Check inventory availability
    if (pricing_result.pricing_details.quantity > inventory_status.quantity_available) {
        decision.status = 'REJECTED';
        decision.reasoning.push(`Insufficient inventory. Requested: ${pricing_result.pricing_details.quantity}, Available: ${inventory_status.quantity_available}`);
        decision.alternatives.push({
            type: 'QUANTITY_ADJUSTMENT',
            suggestion: `Consider ordering maximum available quantity: ${inventory_status.quantity_available}`
        });
        return decision;
    }

    // Check if delivery location is serviceable
    if (!pricing_result.pricing_details.shipping_type) {
        decision.status = 'REJECTED';
        decision.reasoning.push('Delivery location not serviceable');
        return decision;
    }

    // Check if total cost is within reasonable range
    // For this example, we'll assume orders above $10,000 need special approval
    if (pricing_result.total_cost > 10000) {
        decision.status = 'NEEDS_CLARIFICATION';
        decision.reasoning.push('Order value exceeds standard limit of $10,000');
        decision.alternatives.push({
            type: 'SPECIAL_APPROVAL',
            suggestion: 'Order requires management approval due to high value'
        });
        return decision;
    }

    // If all checks pass, approve the order
    decision.status = 'APPROVED';
    decision.reasoning.push('All criteria met: inventory available, location serviceable, cost within limits');
    
    return decision;
}

// Mask sensitive data in objects for logging
function maskSensitiveData(data) {
    if (!data) return data;
    const maskedData = JSON.parse(JSON.stringify(data));
    
    // Mask email addresses
    if (maskedData.sender_email) {
        maskedData.sender_email = '***@***.com';
    }
    
    // Mask any credentials or tokens if present
    if (maskedData.credentials) {
        maskedData.credentials = '***masked***';
    }

    return maskedData;
}

// Process pricing data and make decisions
async function processDecisionRequest(message) {
    try {
        // Handle potential double-parsing
        let data = typeof message === 'string' ? JSON.parse(message) : message;
        if (typeof data === 'string') {
            data = JSON.parse(data);
        }

        console.log('\n🤔 Making decision based on:');
        console.log('Received data:', JSON.stringify(maskSensitiveData(data), null, 2));

        const { 
            product_name, 
            quantity, 
            pricing_result, 
            inventory_status,
            sender_name,
            sender_email,
            company_name
        } = data;

        console.log(`Product: ${product_name}`);
        console.log(`   Requested Quantity: ${quantity}`);
        console.log(`   Available Quantity: ${inventory_status.quantity_available}`);
        console.log(`   Total Cost: $${pricing_result.total_cost}`);

        let decision = {
            status: 'PENDING',
            reasoning: [],
            alternatives: [],
            context: {
                pricing: pricing_result,
                inventory: inventory_status,
                delivery: {
                    requested_location: pricing_result.pricing_details.delivery_location,
                    warehouse_location: inventory_status.warehouse_location,
                    shipping_type: pricing_result.pricing_details.shipping_type
                },
                customer: {
                    name: sender_name,
                    email: sender_email,
                    company: company_name
                }
            }
        };

        // Check inventory availability
        if (inventory_status.quantity_available < quantity) {
            decision.status = 'REJECTED';
            decision.reasoning.push(`Insufficient inventory. Requested: ${quantity}, Available: ${inventory_status.quantity_available}`);
            if (inventory_status.quantity_available > 0) {
                decision.alternatives.push({
                    type: 'reduced_quantity',
                    message: `Consider ordering maximum available quantity: ${inventory_status.quantity_available}`
                });
            }
            return publishDecision(decision, data);
        }

        // Check if delivery location is serviceable
        if (inventory_status.warehouse_location === 'Unknown') {
            decision.status = 'REJECTED';
            decision.reasoning.push('No warehouse available to service this location');
            return publishDecision(decision, data);
        }

        // Add note about regional shipping if applicable
        if (pricing_result.pricing_details.shipping_type === 'regional') {
            decision.reasoning.push(
                `Using warehouse in ${inventory_status.warehouse_location} for delivery to ${pricing_result.pricing_details.delivery_location}. ` +
                `Regional shipping rate of $${pricing_result.shipping_cost} will apply.`
            );
        }

        // Check if total cost is within reasonable limits (e.g., $10,000)
        const COST_THRESHOLD = 10000;
        if (pricing_result.total_cost > COST_THRESHOLD) {
            decision.status = 'REJECTED';
            decision.reasoning.push(`Total cost ($${pricing_result.total_cost}) exceeds threshold ($${COST_THRESHOLD})`);
            return publishDecision(decision, data);
        }

        // If all checks pass
        decision.status = 'APPROVED';
        if (decision.reasoning.length === 0) {
            decision.reasoning.push('All criteria met: inventory available, location serviceable, cost within limits');
        }

        return publishDecision(decision, data);
    } catch (error) {
        console.error('❌ Error processing decision:', error);
        throw error;
    }
}

// Helper function to publish decision and log it
async function publishDecision(decision, originalData) {
    const response = {
        customer_id: customer_id,
        product_name: originalData.product_name,
        quantity: originalData.quantity,
        decision_result: decision,
        timestamp: new Date().toISOString()
    };

    console.log('\n✅ Decision made for', originalData.product_name + ':');
    console.log('   Status:', decision.status);
    console.log('   Reasoning:', decision.reasoning.join('\n              '));
    if (decision.alternatives.length > 0) {
        console.log('   Alternatives offered:');
        decision.alternatives.forEach(alt => {
            console.log(`   - ${alt.message}`);
        });
    }

    const channelName = `decision_channel_${customer_id}`;
    await publishMessage(channelName, response);
    return decision;
}

// Process pricing data and make decisions
async function processDecisionRequestOriginal(message) {
    try {
        // Handle potential double-stringification
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        
        if (typeof data === 'string') {
            data = JSON.parse(data);
        }

        console.log(`\n📋 Processing decision request for ${data.product_name}`);

        // Make decision
        const decisionResult = makeDecision(data);

        // Prepare response
        const response = {
            customer_id: data.customer_id,
            request_id: data.request_id,
            product_name: data.product_name,
            quantity: data.quantity,
            decision_result: decisionResult,
            timestamp: new Date().toISOString()
        };

        // Publish decision result
        const channel = `decision_channel_${customer_id}`;
        await publishMessage(channel, response);
        
        console.log(`\n✅ Decision made for ${data.product_name}:`);
        console.log(`   Status: ${decisionResult.status}`);
        console.log(`   Reasoning: ${decisionResult.reasoning.join(', ')}`);
        if (decisionResult.alternatives.length > 0) {
            console.log('   Alternatives offered:');
            decisionResult.alternatives.forEach(alt => {
                console.log(`   - ${alt.suggestion}`);
            });
        }

    } catch (error) {
        console.error('❌ Error processing decision request:', error);
    }
}

// Subscribe to pricing channel
async function subscribeToDecisionRequests() {
    const channel = `pricing_channel_${customer_id}`;
    
    console.log(`\n👂 Subscribing to ${channel}`);
    await subscriberClient.subscribe(channel, processDecisionRequest);
    console.log(`✅ Successfully subscribed to ${channel}`);
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🔴 Shutting down Decision Agent...');
    await subscriberClient.quit();
    await publisherClient.quit();
    process.exit(0);
});

// Export DecisionAgent class for potential direct usage
class DecisionAgent {
    constructor() {
        this.name = 'DecisionAgent';
    }

    async process(data) {
        return makeDecision(data);
    }
}

module.exports = DecisionAgent;
