// In-memory IP-based rate limiter — no external dependencies required.
// Uses a Map keyed by IP with automatic expiry cleanup on each access.
// Suitable for Vercel serverless (each instance has its own store; for
// shared limits across instances a Redis-backed limiter would be needed,
// but the cryptographic guest token already provides the primary guard).

const store = new Map();

/**
 * Factory that returns an Express middleware function.
 *
 * @param {object} options
 * @param {number} options.windowMs   - Window size in ms (default 15 min)
 * @param {number} options.max        - Max requests per window per IP
 * @param {string} options.message    - Error message to return on limit hit
 */
const createRateLimiter = ({
    windowMs = 15 * 60 * 1000,
    max      = 20,
    message  = "Too many requests. Please try again later."
} = {}) => {
    return (req, res, next) => {
        const ip  = req.ip || req.socket?.remoteAddress || "unknown";
        const now = Date.now();

        // Fetch or initialise record
        let record = store.get(ip);

        if (!record || now > record.resetAt) {
            // First request in this window, or window has expired — reset
            record = { count: 1, resetAt: now + windowMs };
            store.set(ip, record);
            return next();
        }

        record.count += 1;

        if (record.count > max) {
            const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
            res.set("Retry-After", retryAfterSec);
            return res.status(429).json({
                success: false,
                error:   message,
                retryAfter: retryAfterSec
            });
        }

        return next();
    };
};

module.exports = { createRateLimiter };
