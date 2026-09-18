const express = require("express");
const router = express.Router();
const exchangeController = require("../controllers/exchangeController");
const { authenticateCustomer, optionalAuth } = require("../middleware/authMiddleware");
const { validateRequired } = require("../middleware/validationMiddleware");

// Submit Exchange Request
router.post(
    "/",
    optionalAuth,
    validateRequired(["order_id", "order_item_id", "replacement_variant_id", "reason"]),
    exchangeController.requestExchange
);

// Customer Exchange History
router.get("/my-exchanges", authenticateCustomer, exchangeController.getCustomerExchanges);

module.exports = router;
