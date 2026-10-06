const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");

// Local & OAuth Authentication Routes
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/google", authController.googleAuth);
router.post("/logout", authController.logout);
router.get("/me", requireAuth, authController.getMe);

// Dedicated Admin Authentication Routes
router.post("/admin/login", authController.adminLogin);
router.post("/admin/logout", authController.adminLogout);
router.get("/admin/me", requireAdmin, authController.getAdminMe);

// Email Verification Routes
router.post("/verify-email", authController.verifyEmail);
router.post("/resend-verification", authController.resendVerification);

// Password Reset Routes
router.post("/forgot-password", authController.forgotPassword);
router.get("/verify-reset-token", authController.verifyResetToken);
router.post("/reset-password", authController.resetPassword);

module.exports = router;
