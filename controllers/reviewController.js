const reviewService = require("../services/reviewService");
const { sendSuccess } = require("../utils/responseUtils");

// Public Approved Reviews
const getApprovedReviews = async (req, res, next) => {
    try {
        const { product_id, page, limit } = req.query;
        const result = await reviewService.getApprovedReviews({
            productId: product_id,
            page,
            limit
        });
        return sendSuccess(res, result.reviews, "Reviews fetched", 200, result.pagination);
    } catch (err) {
        next(err);
    }
};

// Submit Review (Open to all customers and store shoppers)
const submitReview = async (req, res, next) => {
    try {
        const { product_id, customer_name, rating, title, description, image_urls } = req.body;
        const review = await reviewService.submitReview({
            productId: product_id,
            customerName: customer_name,
            rating,
            title,
            description,
            imageUrls: image_urls
        });
        return sendSuccess(res, review, "Review submitted and pending moderation", 201);
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getApprovedReviews,
    submitReview
};
