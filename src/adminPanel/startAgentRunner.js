const { spawn } = require("child_process");
const { MongoClient } = require("mongodb");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

// Add error handling for MongoDB URI
if (!process.env.MONGODB_URI) {
    console.error("❌ MONGODB_URI is not defined in .env file");
    process.exit(1);
}

const mongoClient = new MongoClient(process.env.MONGODB_URI);

// Get customer_id from the command-line argument
const args = process.argv.slice(2);
const customerArg = args.find(arg => arg.startsWith("--customer_id="));

if (!customerArg) {
    console.error("❌ Error: No customer_id provided. Usage: node startAgentRunner.js --customer_id=XYZ789");
    process.exit(1);
}

const customer_id = customerArg.split("=")[1];

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

        return customerConfig.assigned_agents.map(agent => agent.agent_name);
    } catch (error) {
        console.error("❌ Error fetching customer agents:", error);
        process.exit(1);
    }
}

async function startCustomerAgents() {
    const assignedAgents = await getAssignedAgents(customer_id);

    assignedAgents.forEach(agent => {
        console.log(`🚀 Starting ${agent} for customer ${customer_id}...`);
        
        // Check if agent is in a subdirectory
        let agentPath;
        if (agent.includes('/')) {
            // For agents in subdirectories (e.g. property-management/PropertyResponseAgent)
            agentPath = path.join(__dirname, '../agents', `${agent}.js`);
        } else {
            // For agents in the main agents directory
            agentPath = path.join(__dirname, '../agents', `${agent}.js`);
        }

        const process = spawn("node", [agentPath, customer_id], {
            stdio: "inherit"
        });

        process.on("error", (error) => {
            console.error(`❌ ${agent} for ${customer_id} failed to start:`, error);
        });

        process.on("exit", (code, signal) => {
            if (code !== 0) {
                console.error(`❌ ${agent} for ${customer_id} crashed. Restarting in 3 seconds...`);
                setTimeout(() => {
                    startCustomerAgents();
                }, 3000);
            }
        });

        runningAgents.set(`${customer_id}_${agent}`, process);
    });
}

// Handle shutdown
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
