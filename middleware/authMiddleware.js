const jwt = require("jsonwebtoken");
const supabase = require("../config/supabase");

const COOKIE_NAME = "keeper_token";

const getCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
  };
};

const sanitizeUser = (user) => ({
  id: user.id,
  full_name: user.full_name,
  email: user.email,
  role: user.role,
  auth_provider: user.auth_provider,
  is_verified: user.is_verified,
  created_at: user.created_at,
  updated_at: user.updated_at
});

const requireAuth = async (req, res, next) => {
  try {
    let token = req.cookies?.[COOKIE_NAME];

    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(" ");
      if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
        token = parts[1];
      }
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    const secret = process.env.JWT_SECRET || "keeper-sports-dev-jwt-secret-replace-in-production";
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (jwtErr) {
      res.clearCookie(COOKIE_NAME, { ...getCookieOptions(), maxAge: 0 });
      return res.status(401).json({
        success: false,
        message: "Session expired or invalid."
      });
    }

    // Isolate portal sessions: admin portal tokens are not customer sessions
    if (decoded.portal === "admin") {
      return res.status(401).json({
        success: false,
        message: "Customer authentication required."
      });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("id, full_name, email, role, auth_provider, is_verified, created_at, updated_at")
      .eq("id", decoded.id)
      .maybeSingle();

    if (error || !user) {
      res.clearCookie(COOKIE_NAME, { ...getCookieOptions(), maxAge: 0 });
      return res.status(401).json({
        success: false,
        message: "User account not found."
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal authentication error."
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    let token = req.cookies?.[COOKIE_NAME];

    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(" ");
      if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
        token = parts[1];
      }
    }

    if (!token) {
      req.user = null;
      return next();
    }

    const secret = process.env.JWT_SECRET || "keeper-sports-dev-jwt-secret-replace-in-production";
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch {
      req.user = null;
      return next();
    }

    // Isolate portal sessions: admin portal tokens never act as storefront customer sessions
    if (decoded.portal === "admin") {
      req.user = null;
      return next();
    }

    const { data: user } = await supabase
      .from("users")
      .select("id, full_name, email, role, auth_provider, is_verified, created_at, updated_at")
      .eq("id", decoded.id)
      .maybeSingle();

    req.user = user || null;
    next();
  } catch {
    req.user = null;
    next();
  }
};

const ADMIN_COOKIE_NAME = "keeper_admin_token";

const requireAdmin = async (req, res, next) => {
  try {
    let token = null;

    // 1. Authorization header (Bearer token) takes highest precedence
    if (req.headers.authorization) {
      const parts = req.headers.authorization.split(" ");
      if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
        token = parts[1];
      }
    }

    // 2. Dedicated admin cookie takes second precedence
    if (!token && req.cookies?.[ADMIN_COOKIE_NAME]) {
      token = req.cookies[ADMIN_COOKIE_NAME];
    }

    // Isolated: NEVER fall back to customer storefront cookie (COOKIE_NAME)
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Administrator authentication required."
      });
    }

    const secret = process.env.JWT_SECRET || "keeper-sports-dev-jwt-secret-replace-in-production";
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (jwtErr) {
      res.clearCookie(ADMIN_COOKIE_NAME, { ...getCookieOptions(), maxAge: 0 });
      return res.status(401).json({
        success: false,
        message: "Admin session expired or invalid."
      });
    }

    // Verify user identity and role from real Postgres database
    const { data: user, error } = await supabase
      .from("users")
      .select("id, full_name, email, role, auth_provider, is_verified, created_at, updated_at")
      .eq("id", decoded.id)
      .maybeSingle();

    if (error || !user) {
      res.clearCookie(ADMIN_COOKIE_NAME, { ...getCookieOptions(), maxAge: 0 });
      return res.status(401).json({
        success: false,
        message: "Administrator account not found."
      });
    }

    if (user.role !== "admin" && user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Administrator privileges required."
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("requireAdmin error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal authorization error."
    });
  }
};

module.exports = {
  COOKIE_NAME,
  ADMIN_COOKIE_NAME,
  getCookieOptions,
  sanitizeUser,
  requireAuth,
  optionalAuth,
  requireAdmin
};
