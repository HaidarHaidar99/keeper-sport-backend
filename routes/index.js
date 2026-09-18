const express = require("express");
const router = express.Router();

const authRoutes = require("./authRoutes");
const productRoutes = require("./productRoutes");
const categoryRoutes = require("./categoryRoutes");
const orderRoutes = require("./orderRoutes");
const exchangeRoutes = require("./exchangeRoutes");
const reviewRoutes = require("./reviewRoutes");
const kitRoutes = require("./kitRoutes");
const contentRoutes = require("./contentRoutes");
const adminRoutes = require("./adminRoutes");

// Mount sub-routers under /api
router.use("/auth", authRoutes);
router.use("/products", productRoutes);
router.use("/categories", categoryRoutes);
router.use("/orders", orderRoutes);
router.use("/exchanges", exchangeRoutes);
router.use("/reviews", reviewRoutes);
router.use("/kits", kitRoutes);
router.use("/content", contentRoutes);
router.use("/admin", adminRoutes);

// Health check endpoint
router.get("/health", (req, res) => {
    res.json({
        success: true,
        status: "ok",
        timestamp: new Date().toISOString(),
        service: "Keeper Sports REST API"
    });
});

module.exports = router;
