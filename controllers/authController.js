const authService  = require("../services/authService");
const { sendSuccess, sendError } = require("../utils/responseUtils");

// ── Cookie configuration ──────────────────────────────────────────────────────
// HttpOnly: JS cannot read the token.
// Secure:   HTTPS-only in production (Vercel always serves HTTPS).
// SameSite: Lax — cookie is sent on top-level navigations + same-site requests.
// maxAge:   7 days, matches JWT expiry in tokenUtils.js.
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge:   7 * 24 * 60 * 60 * 1000  // 7 days in ms
};

// ── Admin Login ───────────────────────────────────────────────────────────────
// Admin JWT stays in the response body — the admin SPA stores it in memory /
// localStorage and sends it as an Authorization: Bearer header. Admin sessions
// do NOT use cookies (admin panel is a separate, protected SPA).
const adminLogin = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const result = await authService.adminLogin(email, password);
        // Return token + admin profile (admin panel needs the raw token)
        return sendSuccess(res, result, "Admin login successful");
    } catch (err) {
        next(err);
    }
};

// ── Customer Registration ─────────────────────────────────────────────────────
// Sets HttpOnly cookie. Raw JWT is NOT returned in the response body.
const customerRegister = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const { token, customer } = await authService.customerRegister(email, password);

        res.cookie("token", token, COOKIE_OPTIONS);

        // Return only the safe customer profile — no raw token in body
        return sendSuccess(res, customer, "Account created successfully", 201);
    } catch (err) {
        next(err);
    }
};

// ── Customer Login ────────────────────────────────────────────────────────────
// Sets HttpOnly cookie. Raw JWT is NOT returned in the response body.
const customerLogin = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const { token, customer } = await authService.customerLogin(email, password);

        res.cookie("token", token, COOKIE_OPTIONS);

        // Return only the safe customer profile — no raw token in body
        return sendSuccess(res, customer, "Login successful");
    } catch (err) {
        next(err);
    }
};

// ── Customer Logout ───────────────────────────────────────────────────────────
// Clears the HttpOnly cookie server-side. Safe even if cookie is already gone.
const customerLogout = (req, res) => {
    res.clearCookie("token", {
        httpOnly: true,
        secure:   process.env.NODE_ENV === "production",
        sameSite: "Lax"
    });
    return sendSuccess(res, null, "Logged out successfully");
};

// ── Get Current Customer Profile ──────────────────────────────────────────────
const getProfile = async (req, res, next) => {
    try {
        const customer = await authService.getCustomerProfile(req.customer.id);
        return sendSuccess(res, customer, "Profile fetched");
    } catch (err) {
        next(err);
    }
};

// ── Update Customer Profile ───────────────────────────────────────────────────
const updateProfile = async (req, res, next) => {
    try {
        const updated = await authService.updateCustomerProfile(req.customer.id, req.body);
        return sendSuccess(res, updated, "Profile updated successfully");
    } catch (err) {
        next(err);
    }
};

module.exports = {
    adminLogin,
    customerRegister,
    customerLogin,
    customerLogout,
    getProfile,
    updateProfile
};
