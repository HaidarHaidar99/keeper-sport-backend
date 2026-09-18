// Standardized API response utilities for Keeper Sports

const sendSuccess = (res, data = null, message = "Success", statusCode = 200, meta = null) => {
    const response = {
        success: true,
        message,
        data
    };
    if (meta) {
        response.meta = meta;
    }
    return res.status(statusCode).json(response);
};

const sendError = (res, message = "An error occurred", statusCode = 500, details = null) => {
    const response = {
        success: false,
        error: message
    };
    if (details && process.env.NODE_ENV !== "production") {
        response.details = details;
    }
    return res.status(statusCode).json(response);
};

module.exports = {
    sendSuccess,
    sendError
};
