require("dotenv").config();
const express = require("express");
const cors = require("cors");
const supabase = require("./config/supabase");

const app = express();
const PORT = process.env.PORT || 6000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Base Health Check
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Keeper Sports Clean Backend is Ready",
    timestamp: new Date().toISOString()
  });
});

// Database Connectivity Check
app.get("/api/health", async (req, res) => {
  try {
    // Quick probe to verify Supabase credentials and connection
    const { error } = await supabase.from("_probe").select("*").limit(1);
    // 42P01 (relation does not exist) is normal because DB is empty, but proves connection works!
    const isConnected = !error || error.code === "42P01";
    res.json({
      success: true,
      database: isConnected ? "connected" : "error",
      details: isConnected ? "Supabase connection verified (Clean Schema)" : error.message
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Clean backend running on port ${PORT}`));
}

module.exports = app;