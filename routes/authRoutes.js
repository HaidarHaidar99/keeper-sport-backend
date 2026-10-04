const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");

// Authentication Routes
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/google", authController.googleAuth);
router.post("/logout", authController.logout);
router.get("/me", requireAuth, authController.getMe);

module.exports = router;
