const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const supabase = require("../config/supabase");
const { COOKIE_NAME, getCookieOptions, sanitizeUser } = require("../middleware/authMiddleware");
const { sendVerificationEmail, sendPasswordResetEmail } = require("../utils/emailService");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Local registration
 * POST /api/auth/register
 */
const register = async (req, res) => {
  try {
    const { full_name, email, password, confirm_password, confirmPassword } = req.body;
    const finalConfirmPassword = confirm_password !== undefined ? confirm_password : confirmPassword;

    // 1. Validation
    if (!full_name || typeof full_name !== "string" || full_name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Full name is required."
      });
    }

    if (full_name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Full name must be at least 2 characters."
      });
    }

    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: "A valid email address is required."
      });
    }

    if (!password || typeof password !== "string") {
      return res.status(400).json({
        success: false,
        message: "Password is required."
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long."
      });
    }

    if (password.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Password cannot exceed 128 characters."
      });
    }

    if (!finalConfirmPassword || password !== finalConfirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 2. Check if user already exists
    const { data: existingUser, error: findError } = await supabase
      .from("users")
      .select("id, email, auth_provider")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (findError) {
      console.error("Database error checking existing user:", findError);
      return res.status(500).json({
        success: false,
        message: "Database check failed. Please try again."
      });
    }

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email address already exists."
      });
    }

    // 3. Hash password securely using bcryptjs
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // 4. Generate secure email verification token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    // 5. Create local unverified user
    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        full_name: full_name.trim(),
        email: normalizedEmail,
        password_hash,
        role: "user",
        auth_provider: "local",
        google_id: null,
        is_verified: false,
        verification_token_hash: tokenHash,
        verification_token_expires_at: expiresAt
      })
      .select("id, full_name, email, role, auth_provider, is_verified, created_at, updated_at")
      .single();

    if (insertError) {
      console.error("Database error inserting user:", insertError);
      return res.status(500).json({
        success: false,
        message: "Failed to create user account. Please try again."
      });
    }

    // 6. Send verification email through Resend (non-blocking failure safe)
    await sendVerificationEmail({
      email: normalizedEmail,
      fullName: full_name.trim(),
      rawToken
    });

    return res.status(201).json({
      success: true,
      message: "Account created successfully. We have sent a verification link to your email.",
      user: sanitizeUser(newUser)
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred during registration."
    });
  }
};

/**
 * Local login
 * POST /api/auth/login
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Fetch user from database
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) {
      console.error("Database error during login:", error);
      return res.status(500).json({
        success: false,
        message: "Authentication service error. Please try again."
      });
    }

    // 2. Validate user existence and local auth shape
    if (!user || user.auth_provider !== "local" || !user.password_hash) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    // 3. Verify password hash
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    // 4. Strict check: Email must be verified before login
    if (!user.is_verified) {
      return res.status(403).json({
        success: false,
        requires_verification: true,
        email: user.email,
        message: "Please verify your email address before signing in."
      });
    }

    // 5. Issue JWT token
    const secret = process.env.JWT_SECRET || "keeper-sports-dev-jwt-secret-replace-in-production";
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      secret,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    // 6. Set HTTP-only cookie
    res.cookie(COOKIE_NAME, token, getCookieOptions());

    return res.json({
      success: true,
      message: "Logged in successfully.",
      token,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred during login."
    });
  }
};

/**
 * Email Verification
 * POST /api/auth/verify-email
 */
const verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== "string" || token.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Verification token is required."
      });
    }

    const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");

    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, full_name, is_verified, verification_token_expires_at")
      .eq("verification_token_hash", tokenHash)
      .maybeSingle();

    if (error) {
      console.error("Database error during email verification:", error);
      return res.status(500).json({
        success: false,
        message: "Database error verifying email."
      });
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or already used verification link. Please request a new one."
      });
    }

    if (user.is_verified) {
      return res.json({
        success: true,
        message: "Your email is already verified. You can sign in now."
      });
    }

    if (user.verification_token_expires_at && new Date(user.verification_token_expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        expired: true,
        email: user.email,
        message: "This verification link has expired. Please request a new one."
      });
    }

    // Mark as verified and invalidate token
    const { error: updateError } = await supabase
      .from("users")
      .update({
        is_verified: true,
        verification_token_hash: null,
        verification_token_expires_at: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("Database error updating user verification status:", updateError);
      return res.status(500).json({
        success: false,
        message: "Could not complete email verification. Please try again."
      });
    }

    return res.json({
      success: true,
      message: "Email verified successfully! You can now sign in to your account."
    });
  } catch (err) {
    console.error("Verify email error:", err);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred during email verification."
    });
  }
};

/**
 * Resend Verification Email
 * POST /api/auth/resend-verification
 */
const resendVerification = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: "A valid email address is required."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, full_name, is_verified, auth_provider, verification_token_expires_at")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) {
      console.error("Database error finding user for resend verification:", error);
      return res.status(500).json({
        success: false,
        message: "Database check failed."
      });
    }

    // Generic safe response if user not found or google provider
    if (!user || user.auth_provider !== "local") {
      return res.json({
        success: true,
        message: "If an unverified account exists for this email, a verification link has been sent."
      });
    }

    if (user.is_verified) {
      return res.json({
        success: true,
        already_verified: true,
        message: "This email is already verified. You can sign in directly."
      });
    }

    // Cooldown rate limit: prevent duplicate spam within 60 seconds
    if (user.verification_token_expires_at) {
      const remainingMs = new Date(user.verification_token_expires_at).getTime() - Date.now();
      const elapsedMs = 24 * 60 * 60 * 1000 - remainingMs;
      if (elapsedMs > 0 && elapsedMs < 60 * 1000) {
        return res.status(429).json({
          success: false,
          message: "Please wait at least 60 seconds before requesting another verification email."
        });
      }
    }

    // Generate new token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await supabase
      .from("users")
      .update({
        verification_token_hash: tokenHash,
        verification_token_expires_at: expiresAt,
        updated_at: new Date().toISOString()
      })
      .eq("id", user.id);

    await sendVerificationEmail({
      email: user.email,
      fullName: user.full_name,
      rawToken
    });

    return res.json({
      success: true,
      message: "A new verification email has been sent. Please check your inbox."
    });
  } catch (err) {
    console.error("Resend verification error:", err);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred while resending verification email."
    });
  }
};

/**
 * Request Password Reset
 * POST /api/auth/forgot-password
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: "A valid email address is required."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, full_name, auth_provider, password_reset_token_expires_at")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) {
      console.error("Database error looking up user for password reset:", error);
      return res.status(500).json({
        success: false,
        message: "Database check failed."
      });
    }

    // Security: Do not expose if account exists
    const genericSuccess = {
      success: true,
      message: "If an account exists for this email, a password reset link has been sent."
    };

    if (!user || user.auth_provider !== "local") {
      return res.json(genericSuccess);
    }

    // Rate limiting cooldown: 60s
    if (user.password_reset_token_expires_at) {
      const remainingMs = new Date(user.password_reset_token_expires_at).getTime() - Date.now();
      const elapsedMs = 60 * 60 * 1000 - remainingMs;
      if (elapsedMs > 0 && elapsedMs < 60 * 1000) {
        return res.json(genericSuccess);
      }
    }

    // Generate secure reset token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await supabase
      .from("users")
      .update({
        password_reset_token_hash: tokenHash,
        password_reset_token_expires_at: expiresAt,
        updated_at: new Date().toISOString()
      })
      .eq("id", user.id);

    await sendPasswordResetEmail({
      email: user.email,
      fullName: user.full_name,
      rawToken
    });

    return res.json(genericSuccess);
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred while requesting password reset."
    });
  }
};

/**
 * Verify Password Reset Token (Pre-validation)
 * GET /api/auth/verify-reset-token
 */
const verifyResetToken = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== "string" || token.trim().length === 0) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: "Reset token is required."
      });
    }

    const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");

    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, password_reset_token_expires_at")
      .eq("password_reset_token_hash", tokenHash)
      .maybeSingle();

    if (error) {
      console.error("Database error checking reset token:", error);
      return res.status(500).json({
        success: false,
        valid: false,
        message: "Database error checking token."
      });
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: "Invalid or already used password reset link."
      });
    }

    if (user.password_reset_token_expires_at && new Date(user.password_reset_token_expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        valid: false,
        expired: true,
        message: "Password reset link has expired. Please request a new one."
      });
    }

    return res.json({
      success: true,
      valid: true,
      message: "Token is valid."
    });
  } catch (err) {
    console.error("Verify reset token error:", err);
    return res.status(500).json({
      success: false,
      valid: false,
      message: "Unexpected error validating reset token."
    });
  }
};

/**
 * Reset Password
 * POST /api/auth/reset-password
 */
const resetPassword = async (req, res) => {
  try {
    const { token, password, confirm_password, confirmPassword } = req.body;
    const finalConfirmPassword = confirm_password !== undefined ? confirm_password : confirmPassword;

    if (!token || typeof token !== "string" || token.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Password reset token is required."
      });
    }

    if (!password || typeof password !== "string") {
      return res.status(400).json({
        success: false,
        message: "Password is required."
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long."
      });
    }

    if (password.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Password cannot exceed 128 characters."
      });
    }

    if (!finalConfirmPassword || password !== finalConfirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match."
      });
    }

    const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");

    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, password_reset_token_expires_at")
      .eq("password_reset_token_hash", tokenHash)
      .maybeSingle();

    if (error) {
      console.error("Database error looking up user for reset password:", error);
      return res.status(500).json({
        success: false,
        message: "Database check failed."
      });
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or already used password reset link."
      });
    }

    if (user.password_reset_token_expires_at && new Date(user.password_reset_token_expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Password reset link has expired. Please request a new one."
      });
    }

    // Hash new password securely
    const salt = await bcrypt.genSalt(10);
    const new_password_hash = await bcrypt.hash(password, salt);

    // Invalidate reset token and update password
    const { error: updateError } = await supabase
      .from("users")
      .update({
        password_hash: new_password_hash,
        password_reset_token_hash: null,
        password_reset_token_expires_at: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("Database error updating password:", updateError);
      return res.status(500).json({
        success: false,
        message: "Could not update password. Please try again."
      });
    }

    return res.json({
      success: true,
      message: "Password changed successfully."
    });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred while resetting password."
    });
  }
};

/**
 * Google Authentication
 * POST /api/auth/google
 */
const googleAuth = async (req, res) => {
  try {
    const { credential, id_token, token } = req.body;
    const googleToken = credential || id_token || token;

    if (!googleToken) {
      return res.status(400).json({
        success: false,
        message: "Google credential/token is required."
      });
    }

    const clientId = (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "").trim();
    if (!clientId) {
      return res.status(500).json({
        success: false,
        message: "Server configuration missing GOOGLE_CLIENT_ID."
      });
    }

    let payload;
    try {
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({
        idToken: googleToken,
        audience: clientId
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.error("Google token verification failed:", verifyErr.message);
      return res.status(401).json({
        success: false,
        message: "Invalid or expired Google identity credential."
      });
    }

    if (!payload || !payload.sub || !payload.email) {
      return res.status(401).json({
        success: false,
        message: "Invalid Google payload."
      });
    }

    const googleId = payload.sub;
    const email = payload.email.trim().toLowerCase();
    const fullName = payload.name || payload.given_name || email.split("@")[0];

    const { data: existingUser, error: findError } = await supabase
      .from("users")
      .select("*")
      .or(`google_id.eq.${googleId},email.eq.${email}`)
      .maybeSingle();

    if (findError) {
      console.error("Database error looking up Google user:", findError);
      return res.status(500).json({
        success: false,
        message: "Database query failed."
      });
    }

    let user = existingUser;

    if (user) {
      if (user.auth_provider === "local" && !user.google_id) {
        return res.status(409).json({
          success: false,
          message: "An account with this email was registered using email/password. Please sign in using your password."
        });
      }
    } else {
      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert({
          full_name: fullName,
          email,
          password_hash: null,
          role: "user",
          auth_provider: "google",
          google_id: googleId,
          is_verified: payload.email_verified || true
        })
        .select("id, full_name, email, role, auth_provider, is_verified, created_at, updated_at")
        .single();

      if (insertError) {
        console.error("Database error creating Google user:", insertError);
        return res.status(500).json({
          success: false,
          message: "Failed to create user with Google."
        });
      }
      user = newUser;
    }

    const secret = process.env.JWT_SECRET || "keeper-sports-dev-jwt-secret-replace-in-production";
    const sessionToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      secret,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    res.cookie(COOKIE_NAME, sessionToken, getCookieOptions());

    return res.json({
      success: true,
      message: "Signed in with Google successfully.",
      token: sessionToken,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error("Google auth endpoint error:", err);
    return res.status(500).json({
      success: false,
      message: "Unexpected error during Google authentication."
    });
  }
};

/**
 * Logout
 * POST /api/auth/logout
 */
const logout = async (req, res) => {
  try {
    res.clearCookie(COOKIE_NAME, {
      ...getCookieOptions(),
      maxAge: 0
    });

    return res.json({
      success: true,
      message: "Signed out successfully."
    });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({
      success: false,
      message: "Error signing out."
    });
  }
};

/**
 * Admin portal authentication
 * POST /api/auth/admin/login
 * Strict check: user MUST have role 'admin' or 'super_admin'
 * Sets keeper_admin_token and leaves customer keeper_token untouched
 */
const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Fetch user from database
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) {
      console.error("Database error during admin login:", error);
      return res.status(500).json({
        success: false,
        message: "Authentication service error. Please try again."
      });
    }

    if (!user || user.auth_provider !== "local" || !user.password_hash) {
      return res.status(401).json({
        success: false,
        message: "Invalid administrator credentials."
      });
    }

    // 2. Strict Role verification
    if (user.role !== "admin" && user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Access Denied: This account does not possess administrator privileges."
      });
    }

    // 3. Verify password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid administrator credentials."
      });
    }

    // 4. Issue Admin JWT
    const secret = process.env.JWT_SECRET || "keeper-sports-dev-jwt-secret-replace-in-production";
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, portal: "admin" },
      secret,
      { expiresIn: "7d" }
    );

    // 5. Set HTTP-only admin cookie (keeper_admin_token)
    res.cookie("keeper_admin_token", token, getCookieOptions());

    return res.json({
      success: true,
      message: "Admin authenticated successfully.",
      token,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error("Admin login error:", err);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred during admin login."
    });
  }
};

/**
 * Admin portal logout
 * POST /api/auth/admin/logout
 */
const adminLogout = async (req, res) => {
  try {
    res.clearCookie("keeper_admin_token", {
      ...getCookieOptions(),
      maxAge: 0
    });
    return res.json({
      success: true,
      message: "Admin signed out successfully."
    });
  } catch (err) {
    console.error("Admin logout error:", err);
    return res.status(500).json({
      success: false,
      message: "Error signing out admin."
    });
  }
};

/**
 * Get current admin session
 * GET /api/auth/admin/me
 */
const getAdminMe = async (req, res) => {
  return res.json({
    success: true,
    user: sanitizeUser(req.user)
  });
};

/**
 * Get current authenticated user session
 * GET /api/auth/me
 */
const getMe = async (req, res) => {
  return res.json({
    success: true,
    user: sanitizeUser(req.user)
  });
};

module.exports = {
  register,
  login,
  adminLogin,
  adminLogout,
  getAdminMe,
  verifyEmail,
  resendVerification,
  forgotPassword,
  verifyResetToken,
  resetPassword,
  googleAuth,
  logout,
  getMe
};
