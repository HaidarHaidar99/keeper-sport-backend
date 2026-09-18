const multer              = require("multer");
const { uploadImageToStorage } = require("../services/storageService");
const { sendSuccess, sendError } = require("../utils/responseUtils");

// ── Multer configuration ──────────────────────────────────────────────────────

const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per file
const MAX_FILES      = 3;               // Mirrors review_images 3-image limit

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(
            Object.assign(new Error("Only JPEG, PNG, and WebP images are accepted"), { statusCode: 400 }),
            false
        );
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_SIZE_BYTES,
        files:    MAX_FILES
    }
});

// ── Controller ────────────────────────────────────────────────────────────────

/**
 * POST /api/reviews/upload
 * Accepts up to 3 image files (field name: "images").
 * Uploads each to Supabase Storage via the backend service-role key.
 * Returns an array of safe public URLs to embed in the review submission.
 */
const uploadReviewImages = [
    // Multer middleware — processes multipart/form-data before the handler
    upload.array("images", MAX_FILES),

    async (req, res, next) => {
        try {
            if (!req.files || req.files.length === 0) {
                return sendError(res, "At least one image file is required", 400);
            }

            const urls = await Promise.all(
                req.files.map((file) =>
                    uploadImageToStorage(
                        file.buffer,
                        file.mimetype,
                        file.originalname,
                        "reviews"
                    )
                )
            );

            return sendSuccess(res, { urls }, "Images uploaded successfully", 201);
        } catch (err) {
            next(err);
        }
    }
];

module.exports = { uploadReviewImages };
