const Redis = require("redis");
const { publishMessage } = require("../utils/redis/publisher");
require("dotenv").config();

// Get customer_id from command-line arguments
const customer_id = process.argv[2];

if (!customer_id) {
    console.error("❌ Error: No customer_id provided. Usage: node pricingAgent.js <customer_id>");
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
        await subscribeToPricingRequests();
    } catch (error) {
        console.error('❌ Redis connection error:', error);
        process.exit(1);
    }
})();

// Check if locations are in the same region (temporary implementation)
function areLocationsInSameRegion(location1, location2) {
    console.log(`🔍 Checking locations:`);
    console.log(`   Location 1: ${location1}`);
    console.log(`   Location 2: ${location2}`);
    
    // Extract main city/region from locations (before any comma)
    const city1 = location1.split(',')[0].trim().toLowerCase();
    const city2 = location2.split(',')[0].trim().toLowerCase();
    
    const sameRegion = city1 === city2;
    console.log(`   Result: Locations are ${sameRegion ? 'IN' : 'NOT in'} the same region`);
    
    return sameRegion;
}

// Calculate total cost based on inventory data
function calculateTotalCost(data) {
    const { quantity, inventory_status, delivery_location } = data;
    const { unit_price, shipping_price, warehouse_location } = inventory_status;
    
    console.log('\n📊 Calculating total cost:');
    
    // Parse quantity - handle both number and string formats
    let numericQuantity;
    if (typeof quantity === 'string') {
        numericQuantity = parseInt(quantity.split(' ')[0]);
    } else if (typeof quantity === 'number') {
        numericQuantity = quantity;
    } else {
        throw new Error(`Invalid quantity format: ${typeof quantity}`);
    }

    console.log(`   Quantity: ${quantity} (Numeric: ${numericQuantity})`);
    console.log(`   Unit Price: $${unit_price}`);
    console.log(`   Shipping Options: Local=$${shipping_price.local}, Regional=$${shipping_price.regional}`);
    
    // Check if locations are in the same region
    const sameRegion = areLocationsInSameRegion(delivery_location, warehouse_location);
    
    // Apply local shipping if same region, otherwise regional
    const shippingCost = sameRegion ? shipping_price.local : shipping_price.regional;
    console.log(`   Selected Shipping: ${sameRegion ? 'Local' : 'Regional'} ($${shippingCost})`);

    // Calculate costs
    const subtotal = numericQuantity * unit_price;
    const total = subtotal + shippingCost;
    
    console.log(`   Subtotal: $${subtotal}`);
    console.log(`   Total with Shipping: $${total}\n`);

    return {
        subtotal,
        shipping_cost: shippingCost,
        total_cost: total,
        pricing_details: {
            unit_price,
            quantity: numericQuantity,
            shipping_type: sameRegion ? 'local' : 'regional',
            warehouse_location,
            delivery_location,
            shipping_notes: `Locations determined to be ${sameRegion ? 'in the same' : 'in different'} region(s)`
        }
    };
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

// Process inventory data and calculate pricing
async function processPricingRequest(message) {
    try {
        const data = JSON.parse(message);
        console.log(`📦 Processing pricing request for ${data.product_name}`);
        console.log('Received data:', JSON.stringify(maskSensitiveData(data), null, 2));

        // Calculate pricing
        const pricingResult = calculateTotalCost(data);

        // Publish pricing result
        const channel = `pricing_channel_${customer_id}`;
        await publishMessage(channel, {
            product_name: data.product_name,
            quantity: data.quantity,
            pricing_result: pricingResult,
            inventory_status: data.inventory_status,
            sender_name: data.sender_name,
            sender_email: data.sender_email,
            company_name: data.company_name,
            timestamp: new Date().toISOString()
        });

        console.log(`✅ Published pricing result for ${data.product_name}`);
    } catch (error) {
        console.error('❌ Error processing pricing request:', error);
        console.error('Error details:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// Subscribe to inventory channel
async function subscribeToPricingRequests() {
    try {
        await subscriberClient.subscribe(
            `inventory_channel_${customer_id}`,
            (message) => {
                processPricingRequest(message);
            }
        );
        console.log(`✅ Subscribed to inventory_channel_${customer_id}`);
    } catch (error) {
        console.error('❌ Error subscribing to channel:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🔴 Shutting down Pricing Agent...');
    await subscriberClient.quit();
    await publisherClient.quit();
    process.exit(0);
});

class PricingAgent {
    constructor() {
        this.name = 'PricingAgent';
    }

    async process(item) {
        // Calculate and manage pricing
        console.log('PricingAgent processing item:', item);
    }
}

module.exports = PricingAgent;
