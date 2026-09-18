const supabase   = require("../config/supabase");
const { verifyJwt } = require("../utils/tokenUtils");
const { sendError } = require("../utils/responseUtils");

// ── Token extraction ──────────────────────────────────────────────────────────
// Customer auth: HttpOnly cookie first (approved security model).
// Admin auth:    Authorization: Bearer header only (admin SPA uses localStorage).
// The header fallback for customers is kept for Postman/internal tooling only.

const extractCustomerToken = (req) => {
    // Primary: HttpOnly cookie set by customerLogin / customerRegister
    if (req.cookies?.token) return req.cookies.token;

    // Fallback: Authorization header (Postman / server-to-server only)
    const auth = req.headers.authorization;
    if (auth && auth.startsWith("Bearer ")) return auth.split(" ")[1];

    return null;
};

const extractAdminToken = (req) => {
    // Admin panel uses localStorage → Authorization header only
    const auth = req.headers.authorization;
    if (auth && auth.startsWith("Bearer ")) return auth.split(" ")[1];
    return null;
};

// ── Authenticate Admin or Super Admin ─────────────────────────────────────────
const authenticateAdmin = async (req, res, next) => {
    const token = extractAdminToken(req);
    if (!token) {
        return sendError(res, "Authentication required", 401);
    }

    const decoded = verifyJwt(token);
    if (!decoded || !decoded.id || !["admin", "super_admin"].includes(decoded.role)) {
        return sendError(res, "Invalid or expired admin session", 401);
    }

    try {
        const { data: admin, error } = await supabase
            .from("admins")
            .select("id, email, role, is_active")
            .eq("id", decoded.id)
            .single();

        if (error || !admin || !admin.is_active) {
            return sendError(res, "Admin account inactive or not found", 401);
        }

        req.admin = admin;
        next();
    } catch (err) {
        return next(err);
    }
};

// ── Require Super Admin ───────────────────────────────────────────────────────
const requireSuperAdmin = (req, res, next) => {
    if (!req.admin || req.admin.role !== "super_admin") {
        return sendError(res, "Access denied: Super Admin privileges required", 403);
    }
    next();
};

// ── Authenticate Registered Customer ─────────────────────────────────────────
const authenticateCustomer = async (req, res, next) => {
    const token = extractCustomerToken(req);
    if (!token) {
        return sendError(res, "Authentication required", 401);
    }

    const decoded = verifyJwt(token);
    if (!decoded || !decoded.id || decoded.role !== "customer") {
        return sendError(res, "Invalid or expired session", 401);
    }

    try {
        const { data: customer, error } = await supabase
            .from("customers")
            .select("id, email, is_verified")
            .eq("id", decoded.id)
            .single();

        if (error || !customer) {
            return sendError(res, "Customer account not found", 401);
        }

        req.customer = customer;
        next();
    } catch (err) {
        return next(err);
    }
};

// ── Optional Auth: supports guests and logged-in customers ────────────────────
const optionalAuth = async (req, res, next) => {
    const token = extractCustomerToken(req);
    if (!token) {
        req.customer = null;
        return next();
    }

    const decoded = verifyJwt(token);
    if (!decoded || !decoded.id || decoded.role !== "customer") {
        req.customer = null;
        return next();
    }

    try {
        const { data: customer } = await supabase
            .from("customers")
            .select("id, email, is_verified")
            .eq("id", decoded.id)
            .single();

        req.customer = customer || null;
        next();
    } catch {
        req.customer = null;
        next();
    }
};

module.exports = {
    authenticateAdmin,
    requireSuperAdmin,
    authenticateCustomer,
    optionalAuth
};
