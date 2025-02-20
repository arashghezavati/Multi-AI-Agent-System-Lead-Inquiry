# Lead & Inquiry Automation System 🚀

## 🔹 Overview
The **Lead & Inquiry Automation System** is an **AI-powered workflow** designed to automatically process leads and customer inquiries. It is a part of the **Multi-AI Agent System (MAS)** and serves as an example of how AI agents can be used to automate business communication.

This system **classifies incoming emails**, processes leads efficiently, scores them, and handles order-related inquiries. The AI-driven agents ensure that businesses **never miss a potential lead** and that **orders are processed intelligently**.

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
- 📌 [MAS System Overview](https://github.com/arashghezavati/Multi-AI-Agent-System/docs/01-MAS-System-Overview.md)
- 📌 [Agent Architecture](https://github.com/arashghezavati/Multi-AI-Agent-System/docs/02-Agent-Architecture.md)

---

## 🚀 How to Use
1. **Clone this repository**
   ```sh
   git clone https://github.com/arashghezavati/Multi-AI-Agent-System-Lead-Inquiry.git
   cd Multi-AI-Agent-System-Lead-Inquiry
Install dependencies
sh
Copy
Edit
npm install
Run the AI agents
sh
Copy
Edit
node src/startAgents.js
🤝 Contributing
We welcome contributions! To contribute:

Fork the repository.
Create a feature branch.
Submit a pull request with your improvements.
📜 License
This project is licensed under the MIT License.

💡 Contact
For inquiries, reach out to [Your Contact Info].

yaml
Copy
Edit

---

### **✅ Next Steps**
1. **Copy this into `README.md` inside `Multi-AI-Agent-System-Lead-Inquiry`**.
2. **Commit and push it** to GitHub:
   ```sh
   git add README.md
   git commit -m "Added README for Lead-Inquiry Automation"
   git push origin main