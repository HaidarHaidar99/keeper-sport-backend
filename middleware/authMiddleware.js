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

module.exports = {
  COOKIE_NAME,
  getCookieOptions,
  sanitizeUser,
  requireAuth
};
