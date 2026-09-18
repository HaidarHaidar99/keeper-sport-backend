const express    = require("express");
const router     = express.Router();
const authController = require("../controllers/authController");
const { authenticateCustomer } = require("../middleware/authMiddleware");
const { validateRequired, validateEmail } = require("../middleware/validationMiddleware");

// ── Admin Login ───────────────────────────────────────────────────────────────
router.post(
    "/admin/login",
    validateRequired(["email", "password"]),
    validateEmail("email"),
    authController.adminLogin
);

// ── Customer Registration ─────────────────────────────────────────────────────
router.post(
    "/customer/register",
    validateRequired(["email", "password"]),
    validateEmail("email"),
    authController.customerRegister
);

// ── Customer Login ────────────────────────────────────────────────────────────
router.post(
    "/customer/login",
    validateRequired(["email", "password"]),
    validateEmail("email"),
    authController.customerLogin
);

// ── Customer Logout ───────────────────────────────────────────────────────────
// Clears the HttpOnly JWT cookie. No auth required — safe to call even when
// already logged out (idempotent cookie clear).
router.post("/customer/logout", authController.customerLogout);

// ── Customer Profile ──────────────────────────────────────────────────────────
router.get("/customer/me",       authenticateCustomer, authController.getProfile);
router.patch("/customer/profile", authenticateCustomer, authController.updateProfile);

module.exports = router;
