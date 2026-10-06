const express = require("express");
const router = express.Router();
const { optionalAuth } = require("../middleware/authMiddleware");
const {
  getUserOrders,
  createOrder,
  getOrderById
} = require("../controllers/orderController");

// Customer & Guest orders list
router.get("/", optionalAuth, getUserOrders);

// Checkout / Place order (guests and authenticated)
router.post("/", optionalAuth, createOrder);

// Single order receipt
router.get("/:id", optionalAuth, getOrderById);

module.exports = router;
