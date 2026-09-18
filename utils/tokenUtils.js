const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// Sign a JWT token
const signJwt = (payload, expiresIn = JWT_EXPIRES_IN) => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

// Verify a JWT token
const verifyJwt = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
};

// Generate a cryptographically secure random token (e.g. for guest checkout, password resets)
const generateRandomToken = (bytes = 32) => {
    return crypto.randomBytes(bytes).toString("hex");
};

// Hash a token using SHA-256 (for storing secure guest tokens or reset tokens)
const hashToken = (token) => {
    if (!token) return null;
    return crypto.createHash("sha256").update(token).digest("hex");
};

module.exports = {
    signJwt,
    verifyJwt,
    generateRandomToken,
    hashToken
};
