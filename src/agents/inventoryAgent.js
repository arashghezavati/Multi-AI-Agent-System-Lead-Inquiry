const { MongoClient } = require("mongodb");
const Redis = require("redis");
const { publishMessage } = require("../utils/redis/publisher");
require("dotenv").config();

// Get customer_id from command-line arguments
const customer_id = process.argv[2];

if (!customer_id) {
    console.error("❌ Error: No customer_id provided. Usage: node inventoryAgent.js <customer_id>");
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
    } catch (error) {
        console.error('❌ Redis connection error:', error);
        process.exit(1);
    }
})();

// Connect to our MongoDB to get customer inventory configuration
async function getCustomerInventoryConfig(customer_id) {
    const adminClient = new MongoClient(process.env.MONGODB_URI);
    try {
        await adminClient.connect();
        const db = adminClient.db('multi_ai_system');  // Use the correct database name
        const customerConfig = await db.collection("customers_config").findOne({ customer_id });

        if (!customerConfig || !customerConfig.data_sources?.inventory) {
            throw new Error(`❌ No inventory configuration found for customer ${customer_id}`);
        }

        return customerConfig.data_sources.inventory;
    } finally {
        await adminClient.close();
    }
}

// Check inventory in customer's database
async function checkInventory(inventoryConfig, productName, deliveryLocation) {
    if (inventoryConfig.type !== 'NoSQL' || inventoryConfig.platform !== 'MongoDB') {
        throw new Error(`❌ Unsupported database type: ${inventoryConfig.type} ${inventoryConfig.platform}`);
    }

    if (!inventoryConfig.connection_string) {
        throw new Error('❌ No connection string provided in inventory configuration');
    }

    const customerClient = new MongoClient(inventoryConfig.connection_string, { family: 4 });
    
    try {
        await customerClient.connect();
        const db = customerClient.db();
        const collection = db.collection(inventoryConfig.inventory_source);

        // First try exact location match
        const exactMatch = await collection.findOne({
            [inventoryConfig.product_field_mapping.product_name]: {
                $regex: new RegExp(`^${productName}$`, 'i')
            },
            [inventoryConfig.product_field_mapping.warehouse_location]: {
                $regex: new RegExp(`^${deliveryLocation}$`, 'i')
            }
        });

        if (exactMatch && exactMatch[inventoryConfig.product_field_mapping.quantity_available] > 0) {
            console.log(`✅ Found exact warehouse match in ${exactMatch[inventoryConfig.product_field_mapping.warehouse_location]}`);
            return {
                quantity_available: exactMatch[inventoryConfig.product_field_mapping.quantity_available],
                warehouse_location: exactMatch[inventoryConfig.product_field_mapping.warehouse_location],
                unit_price: exactMatch.unit_price,
                shipping_price: {
                    local: exactMatch.shipping_price?.[0]?.local || 0,
                    regional: exactMatch.shipping_price?.[0]?.regional || 0
                },
                status: 'Available'
            };
        }

        // If no exact match, find all warehouses with available inventory
        const availableWarehouses = await collection.find({
            [inventoryConfig.product_field_mapping.product_name]: {
                $regex: new RegExp(`^${productName}$`, 'i')
            },
            [inventoryConfig.product_field_mapping.quantity_available]: { $gt: 0 }
        }).toArray();

        if (availableWarehouses.length === 0) {
            console.log(`❌ No warehouses found with available ${productName}`);
            return {
                quantity_available: 0,
                warehouse_location: 'Unknown',
                unit_price: 0,
                shipping_price: { local: 0, regional: 0 },
                status: 'Out of Stock'
            };
        }

        // For now, just return the first available warehouse
        // TODO: Implement actual distance calculation between warehouses and delivery location
        const bestWarehouse = availableWarehouses[0];
        console.log(`✅ Found alternative warehouse in ${bestWarehouse[inventoryConfig.product_field_mapping.warehouse_location]}`);

        return {
            quantity_available: bestWarehouse[inventoryConfig.product_field_mapping.quantity_available],
            warehouse_location: bestWarehouse[inventoryConfig.product_field_mapping.warehouse_location],
            unit_price: bestWarehouse.unit_price,
            shipping_price: {
                local: bestWarehouse.shipping_price?.[0]?.local || 0,
                regional: bestWarehouse.shipping_price?.[0]?.regional || 0
            },
            is_alternative_location: true,
            status: 'Available'
        };

    } catch (error) {
        console.error('❌ MongoDB error:', error);
        throw error;
    } finally {
        await customerClient.close();
    }
}

// Process parsed email and check inventory
async function processInventoryRequest(message) {
    try {
        const parsedEmail = JSON.parse(message);
        
        // Map the fields to our expected format
        const normalizedData = {
            product_name: parsedEmail['Product Name'] || parsedEmail.product_name,
            quantity: parsedEmail['Quantity'] || parsedEmail.quantity,
            type: parsedEmail['Type'] || parsedEmail.type,
            delivery_date: parsedEmail['Delivery Date'] || parsedEmail.delivery_date,
            delivery_location: parsedEmail['Delivery Location'] || parsedEmail.delivery_location,
            sender_name: parsedEmail.sender_name,
            sender_email: parsedEmail.sender_email,
            company_name: parsedEmail.company_name
        };

        // Get customer's inventory configuration
        const inventoryConfig = await getCustomerInventoryConfig(customer_id);
        
        // Check inventory
        const inventoryStatus = await checkInventory(
            inventoryConfig, 
            normalizedData.product_name, 
            normalizedData.delivery_location
        );

        // Prepare response
        const response = {
            ...normalizedData,
            inventory_status: {
                quantity_available: inventoryStatus?.quantity_available || 0,
                warehouse_location: inventoryStatus?.warehouse_location || "Unknown",
                unit_price: inventoryStatus?.unit_price || 0,
                shipping_price: inventoryStatus?.shipping_price || { local: 0, regional: 0 },
                status: inventoryStatus?.status || 'Out of Stock'
            }
        };

        // Publish to inventory channel using the shared publisher utility
        const channelName = `inventory_channel_${customer_id}`;
        console.log(`📢 Publishing to ${channelName}:`, response);
        await publishMessage(channelName, response);
        console.log(`✅ Published inventory status to ${channelName}`);
        
        console.log(`✅ Inventory status for ${normalizedData.product_name}: ${response.inventory_status.status}`);
    } catch (error) {
        console.error("❌ Error processing inventory request:", error.message);
    }
}

// Subscribe to parsed email channel
async function subscribeToParsedEmails() {
    await subscriberClient.subscribe(
        `parsed_email_channel_${customer_id}`,
        async (message) => {
            console.log(`📩 Received parsed email data:`, message);
            await processInventoryRequest(message);
        }
    );

    console.log(`✅ Inventory Agent subscribed to parsed_email_channel_${customer_id}`);
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🔴 Shutting down Inventory Agent...');
    await subscriberClient.quit();
    await publisherClient.quit();
    process.exit(0);
});

// Start the agent
subscribeToParsedEmails();
