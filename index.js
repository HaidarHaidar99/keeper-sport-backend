require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const supabase = require("./config/supabase");
const authRoutes = require("./routes/authRoutes");

const app = express();
const PORT = process.env.PORT || 6000;

// Production CORS: Allow frontend vercel deployment and any subdomains
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "https://keeper-sport-frontend.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000"
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith(".vercel.app") ||
        process.env.NODE_ENV !== "production"
      ) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);

app.use(express.json());
app.use(cookieParser());

// Base Health Check
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Keeper Sports Backend is Ready",
    timestamp: new Date().toISOString()
  });
});

// Database Connectivity Check
app.get("/api/health", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("site_settings")
      .select("id, site_name")
      .eq("id", 1)
      .maybeSingle();

    const isConnected = !error && data !== null;
    res.json({
      success: true,
      database: isConnected ? "connected" : "error",
      details: isConnected ? `Supabase connected (Site: ${data.site_name})` : error?.message
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Mount Authentication Routes
app.use("/api/auth", authRoutes);

// Catch-all 404: ALWAYS return JSON, NEVER return HTML
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.method} ${req.originalUrl}`
  });
});

// Catch-all error handler: ALWAYS return JSON, NEVER return HTML
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error"
  });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
}

module.exports = app;