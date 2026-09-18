require("dotenv").config();

const express    = require("express");
const cors       = require("cors");
const cookieParser = require("cookie-parser");
const apiRoutes  = require("./routes");
const errorHandler = require("./middleware/errorHandler");

const app  = express();
const PORT = process.env.PORT || 6000;

// ── CORS ─────────────────────────────────────────────────────────────────────
// credentials: true is required so the browser sends/receives HttpOnly cookies.
const allowedOrigins = [
    process.env.FRONTEND_URL,
    "http://localhost:5173",
    "http://localhost:3000"
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow server-to-server / curl / Postman (no Origin header)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) return callback(null, true);

        // In production, reject unlisted origins
        if (process.env.NODE_ENV === "production") {
            return callback(new Error(`CORS: origin ${origin} is not allowed`), false);
        }

        // Allow all origins in development
        return callback(null, true);
    },
    credentials: true  // Required for HttpOnly cookie to be sent cross-origin
}));

// ── Body & Cookie parsers ─────────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());   // Makes req.cookies available for JWT extraction

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Keeper Sports backend API is running",
        version: "2.0.0"
    });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api", apiRoutes);

// ── Centralised error handler ─────────────────────────────────────────────────
app.use(errorHandler);

// ── Listen (skipped on Vercel serverless) ─────────────────────────────────────
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Keeper Sports backend running on port ${PORT}`);
    });
}

module.exports = app;