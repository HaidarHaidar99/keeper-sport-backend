const { sendError } = require("../utils/responseUtils");

// Validate required body fields
const validateRequired = (fields = []) => {
    return (req, res, next) => {
        const missing = [];
        for (const field of fields) {
            if (req.body[field] === undefined || req.body[field] === null || req.body[field] === "") {
                missing.push(field);
            }
        }
        if (missing.length > 0) {
            return sendError(res, `Missing required fields: ${missing.join(", ")}`, 400);
        }
        next();
    };
};

// Validate email format
const validateEmail = (field = "email") => {
    return (req, res, next) => {
        const email = req.body[field];
        if (email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return sendError(res, "Invalid email address format", 400);
            }
        }
        next();
    };
};

module.exports = {
    validateRequired,
    validateEmail
};
