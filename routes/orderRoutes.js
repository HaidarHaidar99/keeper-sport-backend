const express        = require("express");
const router         = express.Router();
const orderController = require("../controllers/orderController");
const { authenticateCustomer, optionalAuth } = require("../middleware/authMiddleware");
const { validateRequired }  = require("../middleware/validationMiddleware");
const { createRateLimiter } = require("../middleware/rateLimitMiddleware");

// Rate limiter for guest order lookup:
// Max 20 requests per IP per 15 minutes.
// The cryptographic guest token (SHA-256 of 32 random bytes) is the primary
// guard; rate limiting is the second layer against timing/brute-force attacks.
const guestOrderLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max:      20,
    message:  "Too many guest order lookup attempts. Please try again in 15 minutes."
});

// ── Place Order (guest or logged-in customer) ─────────────────────────────────
router.post(
    "/",
    optionalAuth,
    validateRequired(["delivery", "items"]),
    orderController.createOrder
);

// ── Guest Order History via X-Guest-Token header ──────────────────────────────
router.get("/guest", guestOrderLimiter, orderController.getGuestOrders);

// ── Customer Order History ────────────────────────────────────────────────────
router.get("/my-orders", authenticateCustomer, orderController.getCustomerOrders);

// ── Single Order Details ──────────────────────────────────────────────────────
router.get("/:id", optionalAuth, orderController.getOrderById);

module.exports = router;
