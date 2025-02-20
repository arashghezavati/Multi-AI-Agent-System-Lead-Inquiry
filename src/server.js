require("dotenv").config();
const connectDB = require("./config/connectDB");

// Connect to MongoDB before starting the server
connectDB();
