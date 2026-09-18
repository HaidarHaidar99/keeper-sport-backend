const { sendError } = require("../utils/responseUtils");

// Centralized error handling middleware
const errorHandler = (err, req, res, next) => {
    // Log detailed error on the server side
    console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err);

    // Prevent response if already sent
    if (res.headersSent) {
        return next(err);
    }

    const statusCode = err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    return sendError(res, message, statusCode, err.details || null);
};

module.exports = errorHandler;
