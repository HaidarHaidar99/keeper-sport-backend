const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const { authenticateAdmin, requireSuperAdmin } = require("../middleware/authMiddleware");
const { validateRequired, validateEmail } = require("../middleware/validationMiddleware");

// All admin routes require valid admin authentication
router.use(authenticateAdmin);

// Dashboard Overview
router.get("/dashboard", adminController.getDashboardStats);

// Store Sales (POS)
router.post(
    "/inventory/store-sale",
    validateRequired(["variant_id", "quantity"]),
    adminController.recordStoreSale
);

// Inventory Restock / Adjustment
router.post(
    "/inventory/adjust",
    validateRequired(["variant_id", "physical_change"]),
    adminController.adjustStock
);

// Inventory Audit Logs
router.get("/inventory/logs", adminController.getInventoryLogs);

// Orders Management
router.get("/orders", adminController.getAllOrders);
router.patch(
    "/orders/:id/status",
    validateRequired(["order_status"]),
    adminController.updateOrderStatus
);

// Reviews Moderation
router.get("/reviews", adminController.getPendingReviews);
router.patch(
    "/reviews/:id",
    validateRequired(["status"]),
    adminController.updateReviewStatus
);

// Exchanges Management
router.get("/exchanges", adminController.getAllExchanges);
router.patch(
    "/exchanges/:id",
    validateRequired(["status"]),
    adminController.updateExchangeStatus
);

// Contact Messages
router.get("/contact-messages", adminController.getContactMessages);
router.patch("/contact-messages/:id/read", adminController.markContactMessageRead);

// Super Admin Only: Admin Accounts Management
router.get("/admins", requireSuperAdmin, adminController.listAdmins);
router.post(
    "/admins",
    requireSuperAdmin,
    validateRequired(["email", "password"]),
    validateEmail("email"),
    adminController.createAdmin
);
router.delete("/admins/:id", requireSuperAdmin, adminController.deleteAdmin);

module.exports = router;
