require("dotenv").config();
const redis = require("redis");

const redisClient = redis.createClient({
    url: process.env.REDIS_URL || "redis://127.0.0.1:6379"
});

redisClient.on("error", (err) => console.error("❌ Redis Error:", err));

async function connectRedis() {
    if (!redisClient.isOpen) {
        await redisClient.connect();
    }
}

// Function to publish messages to a Redis channel
async function publishMessage(channel, message) {
    await connectRedis();
    await redisClient.publish(channel, JSON.stringify(message));
    console.log(`📢 Published message to ${channel}:`, message);
}

module.exports = { publishMessage };
