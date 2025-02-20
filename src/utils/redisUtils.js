const Redis = require("ioredis");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// Initialize Redis client
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

redis.on("error", (error) => {
    console.error("Redis Error:", error);
});

redis.on("connect", () => {
    console.log("✅ Connected to Redis");
});

/**
 * Publish a message to a Redis channel
 * @param {string} channel - The channel to publish to
 * @param {object} message - The message to publish
 */
async function publishMessage(channel, message) {
    try {
        await redis.publish(channel, JSON.stringify(message));
        return true;
    } catch (error) {
        console.error(`Error publishing to ${channel}:`, error);
        throw error;
    }
}

/**
 * Subscribe to a Redis channel
 * @param {string} channel - The channel to subscribe to
 * @param {function} callback - The callback to handle received messages
 */
async function subscribeToChannel(channel, callback) {
    try {
        const subscriber = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
        
        subscriber.subscribe(channel, (error, count) => {
            if (error) {
                console.error(`Error subscribing to ${channel}:`, error);
                throw error;
            }
            console.log(`✅ Subscribed to ${channel}`);
        });

        subscriber.on("message", (channel, message) => {
            try {
                const parsedMessage = JSON.parse(message);
                callback(parsedMessage);
            } catch (error) {
                console.error(`Error processing message from ${channel}:`, error);
            }
        });

        return subscriber;
    } catch (error) {
        console.error(`Error setting up subscription to ${channel}:`, error);
        throw error;
    }
}

module.exports = {
    redis,
    publishMessage,
    subscribeToChannel
};
