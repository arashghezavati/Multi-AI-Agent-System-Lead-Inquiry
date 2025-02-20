# Lead & Inquiry Automation System 🚀

## 🔹 Overview
This repository is part of the [**Multi-AI Agent System (MAS)**](https://github.com/arashghezavati/Multi-AI-Agent-System), specifically designed for **Lead & Inquiry Processing**.  

The **Lead & Inquiry Automation System** is an **AI-powered workflow** designed to automatically process leads and customer inquiries. It is a part of the **Multi-AI Agent System (MAS)** and serves as an example of how AI agents can be used to automate business communication.

This system **classifies incoming emails**, processes leads efficiently, scores them, and handles order-related inquiries. The AI-driven agents ensure that businesses **never miss a potential lead** and that **orders are processed intelligently**.

Using AI-driven automation, this system:  
- 📧 **Classifies incoming emails** (Lead vs. Inquiry)  
- 🎯 **Scores and prioritizes leads** for the sales team  
- 🏗 **Processes orders** by checking inventory, pricing, and availability  
- 🔗 **Sends AI-generated responses** for inquiries and orders  

---

## 🌟 Features
✅ **Intelligent Email Processing** - Automatically detects & classifies leads vs. inquiries  
✅ **AI-Based Lead Scoring** - Determines high-value sales opportunities  
✅ **Automated Order Handling** - Processes orders, checks inventory, and sends responses  
✅ **Multi-Tenant Support** - Each customer operates independently  

---

## 📌 How It Works
The system follows two main workflows:

### **1️⃣ Lead Processing Flow**
📧 **Email → EmailAgent → LeadAgent → ScoringAgent → LeadEmailNotificationAgent → Sales Team**  
✅ **Tasks:**
- Captures **potential customers** from emails.
- **Scores and qualifies leads** based on intent, budget, and urgency.
- Sends **notifications to the sales team** with actionable insights.

### **2️⃣ Inquiry Processing Flow**
📧 **Email → EmailAgent → ParserAgent → InventoryAgent → PricingAgent → DecisionAgent → ResponseAgent → Customer**  
✅ **Tasks:**
- **Processes orders automatically** by extracting details from emails.
- Checks **inventory availability** and **calculates pricing** dynamically.
- Uses AI to **generate professional responses** and send them back to customers.

---

## 📖 Documentation
For a deeper understanding of this system, check out:
- 📌 [MAS System Overview](https://github.com/arashghezavati/Multi-AI-Agent-System/blob/main/docs/01-MAS-System-Overview.md)
- 📌 [Agent Architecture](https://github.com/arashghezavati/Multi-AI-Agent-System/blob/main/docs/02-Agent-Architecture.md)

---

## 📌 Installation & Setup

### 1️⃣ Clone the Repository
```sh
git clone https://github.com/arashghezavati/Multi-AI-Agent-System-Lead-Inquiry.git
cd Multi-AI-Agent-System-Lead-Inquiry
npm install
```

### 2️⃣ Setup: Environment Configuration
Before running the system, you need to create an `.env` file in the root of the project to store important configurations.

#### Create `.env` File
Inside the root directory, create a file named `.env` and add the following variables:

```ini
# MongoDB Connection String
MONGODB_URI=""

# API Gateway Port
API_GATEWAY_PORT=5000

# Redis Connection
REDIS_URL=""

# Google Gemini AI API Key
GOOGLE_GEMINI_API_KEY=""
```

### 3️⃣ Set Up Redis
Redis is required for message-based communication between agents.

1. Navigate to the Redis directory inside your system
2. Start the Redis server:
```sh
redis-server.exe redis.windows.conf
```

### 4️⃣ Create Database and Collections
MongoDB is required to store customers, assigned agents, and credentials.

1. Create a new database in MongoDB
2. Create a collection named `customers` and add a new document:
```json
{
  "customer_id": "XYZ789",
  "company_name": "ABC Construction",
  "created_at": "2024-02-10T10:30:00Z"
}
```

3. Create another collection named `customers_config` to store customer-specific details, including:
   - Assigned AI agents
   - Business details
   - Data sources (e.g., inventory database, CRM)
   - Credentials (e.g., Gmail API)
   - Notification settings

#### Example `customers_config` Document
```json
{
  "_id": "CONFIG123",
  "customer_id": "XYZ789",
  "business_details": {
    "industry": "Construction",
    "business_description": "XYZ789 supplies construction materials.",
    "common_inquiries": "Customers usually ask about product availability, bulk pricing, and delivery times.",
    "required_information": "To process an order, we need to extract the product name, quantity, type, delivery date, and delivery location.",
    "customer_types": "Our customers are construction companies, contractors, and large-scale builders.",
    "special_instructions": "Some customers may request urgent delivery or custom product specifications."
  },
  "assigned_agents": [
    {
      "agent_name": "EmailAgent",
      "status": "active"
    }
  ],
  "data_sources": {
    "inventory": {
      "type": "NoSQL",
      "platform": "MongoDB",
      "connection_string": "",
      "inventory_source": "sale",
      "product_field_mapping": {
        "product_name": "product",
        "quantity_available": "quantity",
        "warehouse_location": "location"
      }
    }
  },
  "credentials": {
    "gmail": {
      "client_id": "",
      "client_secret": "",
      "refresh_token": ""
    }
  },
  "notification_settings": {
    "gmail": {
      "sales_team_email": "example@gmail.com"
    }
  }
}
```

### 5️⃣ Start the AI System
Once everything is configured, you can now start the MAS agent runner.

#### Run the AI Agents
```sh
node src/adminPanel/startAgentRunner.js --customer_id="XYZ789"
```

### 6️⃣ How Everything Works Together (Workflow)
```
Admin ➝ Creates Customer in MongoDB
       ➝ Assigns AI Agents
       ➝ Starts Agents
              ⬇
📂 MongoDB ➝ Stores Customers & Agents
              ⬇
🚀 startAgentRunner.js ➝ Starts Assigned Agents
              ⬇
📧 emailAgent.js ➝ Fetches Emails & Publishes to Redis
              ⬇
📢 Redis ➝ Passes Messages to Other Agents
              ⬇
📝 parserAgent.js ➝ Extracts Data (Next Step)
```

### ✅ Final Summary
- ✔ Each customer has independent AI agents and data
- ✔ Agents start dynamically based on assigned configurations
- ✔ Redis ensures smooth communication between AI agents
- ✔ The system is 100% multi-tenant and scalable

### 🚀 Next Steps
1. Run the setup steps above
2. Check MongoDB collections (`customers` and `customers_config`)
3. Start the agent system (`startAgentRunner.js`)
4. Monitor Redis channels and logs to track the automation in action

🚀 Your Multi-AI Agent System is now live! Let me know if you need any refinements!
