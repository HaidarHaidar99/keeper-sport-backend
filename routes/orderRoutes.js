const express = require("express");
const router = express.Router();
const { optionalAuth } = require("../middleware/authMiddleware");
const {
  getUserOrders,
  createOrder,
  getOrderById,
  cancelOrder,
  deleteOrder
} = require("../controllers/orderController");

// Customer & Guest orders list
router.get("/", optionalAuth, getUserOrders);

// Checkout / Place order (guests and authenticated)
router.post("/", optionalAuth, createOrder);

// Single order receipt
router.get("/:id", optionalAuth, getOrderById);

// Customer cancel order (strictly pending orders only)
router.patch("/:id/cancel", optionalAuth, cancelOrder);
router.post("/:id/cancel", optionalAuth, cancelOrder);

// Customer / Guest delete order
router.delete("/:id", optionalAuth, deleteOrder);

module.exports = router;
