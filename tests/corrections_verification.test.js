const assert = require("assert");
const { createRateLimiter } = require("../middleware/rateLimitMiddleware");
const { signJwt, verifyJwt } = require("../utils/tokenUtils");

console.log("=== KEEPER SPORTS PHASE 2 CORRECTIONS UNIT TESTS ===");

// 1. Test Customer JWT Sign & Verification
console.log("\n[1] Testing Customer JWT Sign & Verification:");
const testCustomer = { id: "00000000-0000-0000-0000-000000000001", role: "customer", email: "fan@keeper.com" };
const token = signJwt(testCustomer);
const decoded = verifyJwt(token);
assert.strictEqual(decoded.id, testCustomer.id);
assert.strictEqual(decoded.role, "customer");
console.log("  ✓ Customer JWT correctly generated and decoded");

// 2. Test Guest Order Rate Limiting Middleware Factory
console.log("\n[2] Testing Guest Order Rate Limiter:");
const testLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 5,
    message: "Rate limit reached"
});

let rateLimitHit = false;
let testIp = "192.168.1.99";

for (let i = 1; i <= 7; i++) {
    let reqRL = {
        ip: testIp,
        headers: {}
    };
    let resRL = {
        statusCode: 200,
        headersSet: {},
        set(header, val) { this.headersSet[header] = val; },
        status(code) { this.statusCode = code; return this; },
        json(data) { this.jsonData = data; return this; }
    };
    let nextRL = false;
    testLimiter(reqRL, resRL, () => { nextRL = true; });

    if (i <= 5) {
        assert(nextRL, `Request ${i} should be allowed`);
    } else {
        assert(!nextRL, `Request ${i} should be rate limited`);
        assert.strictEqual(resRL.statusCode, 429, "Rate limit exceeded must return HTTP 429");
        assert.strictEqual(resRL.jsonData.error, "Rate limit reached");
        rateLimitHit = true;
    }
}
assert(rateLimitHit, "Rate limiter should trigger HTTP 429 after limit is reached");
console.log("  ✓ createRateLimiter correctly tracks counts and blocks excess requests with HTTP 429");

// 3. Test Review Routes & Storage Module Registration
console.log("\n[3] Testing Review Upload Route & Storage Integration:");
const reviewRoutes = require("../routes/reviewRoutes");
assert(reviewRoutes.stack.some(layer => layer.route && layer.route.path === "/upload"), "reviewRoutes must have POST /upload mounted");
console.log("  ✓ POST /api/reviews/upload route is registered");

const storageService = require("../services/storageService");
assert(typeof storageService.uploadImageToStorage === "function", "storageService must export uploadImageToStorage");
console.log("  ✓ storageService exports uploadImageToStorage handler");

// 4. Test Route Layer Integration (Auth logout, Product paginated)
console.log("\n[4] Testing New Auth & Catalog Route Handlers:");
const authRoutes = require("../routes/authRoutes");
assert(authRoutes.stack.some(layer => layer.route && layer.route.path === "/customer/logout"), "authRoutes must mount POST /customer/logout");
console.log("  ✓ POST /api/auth/customer/logout route is registered");

const productRoutes = require("../routes/productRoutes");
assert(productRoutes.stack.some(layer => layer.route && layer.route.path === "/"), "productRoutes must mount GET /");
console.log("  ✓ GET /api/products route is registered");

const orderRoutes = require("../routes/orderRoutes");
assert(orderRoutes.stack.some(layer => layer.route && layer.route.path === "/guest"), "orderRoutes must mount GET /guest");
console.log("  ✓ GET /api/orders/guest route is registered");

console.log("\n=== ALL PHASE 2 CORRECTIONS UNIT TESTS PASSED SUCCESSFULLY ===");
process.exit(0);
