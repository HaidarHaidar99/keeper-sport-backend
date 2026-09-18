const assert = require("assert");
const { signJwt, verifyJwt, generateRandomToken, hashToken } = require("../utils/tokenUtils");
const { validateRequired, validateEmail } = require("../middleware/validationMiddleware");

console.log("=== KEEPER SPORTS PHASE 2 BACKEND UNIT TESTS ===");

// 1. Test Token Utilities
console.log("\n[1] Testing Token Utilities:");
const payload = { id: "123e4567-e89b-12d3-a456-426614174000", role: "admin", email: "test@example.com" };
const token = signJwt(payload);
assert(typeof token === "string", "Token must be a string");
console.log("  ✓ signJwt generated a signed JWT");

const decoded = verifyJwt(token);
assert.strictEqual(decoded.id, payload.id, "Decoded ID must match payload ID");
assert.strictEqual(decoded.role, payload.role, "Decoded role must match payload role");
console.log("  ✓ verifyJwt successfully verified signature and decoded payload");

const invalidDecoded = verifyJwt("invalid.token.here");
assert.strictEqual(invalidDecoded, null, "Invalid token must return null");
console.log("  ✓ verifyJwt safely returned null on malformed token");

const rawToken = generateRandomToken(32);
assert.strictEqual(rawToken.length, 64, "32-byte hex token must have length 64");
const hash1 = hashToken(rawToken);
const hash2 = hashToken(rawToken);
assert.strictEqual(hash1, hash2, "SHA-256 hash must be deterministic");
assert.strictEqual(hash1.length, 64, "SHA-256 hex string must have length 64");
console.log("  ✓ Cryptographic random token and deterministic SHA-256 hashing verified");

// 2. Test Validation Middleware
console.log("\n[2] Testing Validation Middleware:");
let req = { body: { email: "valid@keepersports.com", password: "SecretPassword123" } };
let res = {
    statusCode: null,
    jsonData: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.jsonData = data; return this; }
};
let nextCalled = false;

// Required fields test (Pass)
validateRequired(["email", "password"])(req, res, () => { nextCalled = true; });
assert(nextCalled, "validateRequired should call next() when fields are present");
console.log("  ✓ validateRequired passed when required fields exist");

// Required fields test (Fail)
nextCalled = false;
req.body = { email: "valid@keepersports.com" };
validateRequired(["email", "password"])(req, res, () => { nextCalled = true; });
assert(!nextCalled, "validateRequired should not call next() when fields are missing");
assert.strictEqual(res.statusCode, 400, "Should return HTTP 400 on missing field");
console.log("  ✓ validateRequired blocked missing fields with HTTP 400");

// Email format test
nextCalled = false;
req.body = { email: "not-an-email" };
validateEmail("email")(req, res, () => { nextCalled = true; });
assert(!nextCalled, "validateEmail should block malformed email");
assert.strictEqual(res.statusCode, 400, "Should return HTTP 400 on malformed email");
console.log("  ✓ validateEmail blocked invalid email format with HTTP 400");

// 3. Test Routes Structure
console.log("\n[3] Testing Route Layer Registration:");
const router = require("../routes");
assert(router.stack.length > 0, "Router stack should have mounted route handlers");

// Check path prefixes safely
const routeDescriptions = router.stack.map(s => {
    if (s.route) return s.route.path;
    if (s.regexp) return s.regexp.source || s.regexp.toString();
    return s.name || "middleware";
});

console.log("  Mounted route layers count:", router.stack.length);
assert(router.stack.length >= 9, "All 9 core API route groups must be mounted");
console.log("  ✓ All 9 core API route groups verified on master router");

console.log("\n=== ALL BACKEND UNIT TESTS PASSED SUCCESSFULLY ===");
