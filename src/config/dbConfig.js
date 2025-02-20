require("dotenv").config();

const DATABASE_URL = process.env.MONGODB_URI;

if (!DATABASE_URL) {
    throw new Error("❌ MONGODB_URI is not defined in .env file");
}

module.exports = { DATABASE_URL }; 


