


require("dotenv").config();
const redis = require("redis");

// Initialize Redis Client
const redisClient = redis.createClient({
    url: process.env.REDIS_URL || "redis://127.0.0.1:6379"
});

redisClient.on("error", (err) => console.error("❌ Redis Error:", err));

async function connectRedis() {
    if (!redisClient.isOpen) {
        await redisClient.connect();
        console.log("✅ Connected to Redis");
    }
}

// Subscribe to customer-specific email channel
async function subscribeToChannel(customer_id, callback) {
    await connectRedis();
    const channel = `email_channel_${customer_id}`;

    await redisClient.subscribe(channel, (message) => {
        console.log(`📩 Received message from ${channel}:`, JSON.parse(message));
        callback(JSON.parse(message));
    });

    console.log(`✅ Subscribed to ${channel}`);
}

module.exports = { subscribeToChannel };
