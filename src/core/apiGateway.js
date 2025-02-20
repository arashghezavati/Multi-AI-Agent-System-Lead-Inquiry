require("dotenv").config();
const express = require("express");
const redis = require("redis");

const app = express();
app.use(express.json());

// Create Redis Publisher
const redisClient = redis.createClient({
    url: process.env.REDIS_URL || "redis://127.0.0.1:6379"
});

redisClient.on("error", (err) => console.error("Redis Error:", err));

async function connectRedis() {
    await redisClient.connect();
    console.log("✅ Connected to Redis from API Gateway");
}

connectRedis();

// Endpoint: Receive Emails (Simulating Email Agent Input)
app.post("/api/email", async (req, res) => {
    try {
        const { sender, subject, body } = req.body;

        if (!sender || !subject || !body) {
            return res.status(400).json({ error: "Missing required email fields" });
        }

        const message = {
            sender,
            subject,
            body,
            timestamp: new Date().toISOString()
        };

        // Publish email data to the Message Bus for processing
        await redisClient.publish("email_channel", JSON.stringify(message));
        console.log("📩 Email received and sent to Message Bus:", message);

        res.status(200).json({ message: "Email received and queued for processing" });
    } catch (error) {
        console.error("❌ Error processing email:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Future Expansion: CRM/ERP Data Handling (Placeholder)
app.post("/api/crm", async (req, res) => {
    try {
        const { customerId, requestType, details } = req.body;

        if (!customerId || !requestType) {
            return res.status(400).json({ error: "Missing required CRM fields" });
        }

        const crmMessage = {
            customerId,
            requestType,
            details,
            timestamp: new Date().toISOString()
        };

        await redisClient.publish("crm_channel", JSON.stringify(crmMessage));
        console.log("📊 CRM request received and sent to Message Bus:", crmMessage);

        res.status(200).json({ message: "CRM request received and queued for processing" });
    } catch (error) {
        console.error("❌ Error processing CRM request:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Start API Gateway
const PORT = process.env.API_GATEWAY_PORT || 5000;
app.listen(PORT, () => console.log(`🚀 API Gateway is running on port ${PORT}`));
