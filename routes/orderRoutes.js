const express = require("express");
const router = express.Router();
const { optionalAuth, requireAuth } = require("../middleware/authMiddleware");
const {
  getUserOrders,
  createOrder,
  getOrderById
} = require("../controllers/orderController");

// Customer orders list
router.get("/", requireAuth, getUserOrders);

// Checkout / Place order (guests and authenticated)
router.post("/", optionalAuth, createOrder);

// Single order receipt
router.get("/:id", optionalAuth, getOrderById);

module.exports = router;
