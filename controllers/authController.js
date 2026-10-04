const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const supabase = require("../config/supabase");
const { COOKIE_NAME, getCookieOptions, sanitizeUser } = require("../middleware/authMiddleware");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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

    if (password !== finalConfirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 2. Duplicate email check
    const { data: existingUser, error: checkError } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (checkError) {
      console.error("Database error checking existing user:", checkError);
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

    // 4. Create local user
    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        full_name: full_name.trim(),
        email: normalizedEmail,
        password_hash,
        role: "user",
        auth_provider: "local",
        google_id: null,
        is_verified: false
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

    return res.status(201).json({
      success: true,
      message: "Account created successfully. Please verify your email before logging in.",
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
      message: "Signed in successfully.",
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

    const clientId = process.env.GOOGLE_CLIENT_ID;
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
  googleAuth,
  logout,
  getMe
};
