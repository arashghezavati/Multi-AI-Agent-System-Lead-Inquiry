const { spawn } = require("child_process");
const path = require("path");
const { MongoClient } = require("mongodb");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoClient = new MongoClient(process.env.MONGODB_URI);

// Get customer_id from command-line arguments
const customer_id = process.argv[2];

if (!customer_id) {
    console.error("❌ Error: No customer_id provided. Usage: node agentRunner.js <customer_id>");
    process.exit(1);
}

// Store running agent processes
const runningAgents = new Map();

async function getAssignedAgents(customer_id) {
    try {
        await mongoClient.connect();
        const db = mongoClient.db();
        const customerConfig = await db.collection("customers_config").findOne({ customer_id });

        if (!customerConfig || !customerConfig.assigned_agents) {
            console.error(`❌ No agents assigned for customer ${customer_id}`);
            process.exit(1);
        }

        return customerConfig.assigned_agents;
    } catch (error) {
        console.error("❌ Error fetching customer agents:", error);
        process.exit(1);
    }
}

async function startAgent(agent, instance) {
    console.log(`🚀 Starting ${agent} for customer ${customer_id} (Instance ${instance + 1})...`);
    const process = spawn("node", [path.join(__dirname, `../agents/${agent}.js`), customer_id], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: false
    });

    // Pipe the output to console
    process.stdout.on('data', (data) => {
        console.log(`[${agent}] ${data}`);
    });

    process.stderr.on('data', (data) => {
        console.error(`[${agent}] Error: ${data}`);
    });

    // Store the running process
    const agentKey = `${customer_id}_${agent}_${instance + 1}`;
    runningAgents.set(agentKey, process);

    process.on("exit", (code, signal) => {
        if (signal === "SIGTERM" || code === 0) {
            console.log(`✅ ${agentKey} exited normally.`);
            runningAgents.delete(agentKey);
        } else {
            console.log(`❌ ${agentKey} crashed. Restarting in 3 seconds...`);
            setTimeout(() => startAgent(agent, instance), 3000);
        }
    });
}

async function startCustomerAgents() {
    const assignedAgents = await getAssignedAgents(customer_id);

    assignedAgents.forEach(agent => {
        startAgent(agent, 0);
    });
}

// Handle graceful shutdown
process.on("SIGINT", () => {
    console.log("\n🔴 Shutting down all agents...");
    runningAgents.forEach((process, name) => {
        console.log(`🔴 Stopping ${name}...`);
        process.kill("SIGTERM");
    });
    process.exit();
});

// Start the assigned agents
startCustomerAgents();
