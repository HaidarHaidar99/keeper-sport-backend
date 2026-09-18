const express        = require("express");
const router         = express.Router();
const reviewController       = require("../controllers/reviewController");
const { uploadReviewImages } = require("../controllers/reviewUploadController");
const { validateRequired }   = require("../middleware/validationMiddleware");

// ── Image Upload ──────────────────────────────────────────────────────────────
// MUST be registered before POST "/" to avoid route ambiguity.
// Accepts multipart/form-data, field name "images", up to 3 files.
// Returns: { success: true, data: { urls: ["https://..."] } }
router.post("/upload", uploadReviewImages);

// ── Approved Reviews (public) ─────────────────────────────────────────────────
router.get("/", reviewController.getApprovedReviews);

// ── Submit Review ─────────────────────────────────────────────────────────────
// image_urls must be the safe URLs returned by POST /upload (not raw Supabase
// credentials or arbitrary external URLs).
router.post(
    "/",
    validateRequired(["product_id", "customer_name", "rating", "title", "description", "image_urls"]),
    reviewController.submitReview
);

module.exports = router;
