const path    = require("path");
const { v4: uuidv4 } = require("crypto"); // Using crypto for UUID-like uniqueness
const supabase = require("../config/supabase");

// Derive a safe file extension from mimetype
const extFromMime = (mimetype) => {
    const map = {
        "image/jpeg": "jpg",
        "image/png":  "png",
        "image/webp": "webp"
    };
    return map[mimetype] || "bin";
};

/**
 * Upload a single image buffer to Supabase Storage.
 *
 * @param {Buffer} fileBuffer     - Raw file bytes from multer memoryStorage
 * @param {string} mimetype       - MIME type (e.g. "image/jpeg")
 * @param {string} originalName   - Original filename (used for ext fallback only)
 * @param {string} [folder]       - Storage folder prefix (default: "reviews")
 * @returns {Promise<string>}     - Public URL of the uploaded image
 */
const uploadImageToStorage = async (fileBuffer, mimetype, originalName, folder = "reviews") => {
    const bucket = process.env.SUPABASE_REVIEW_BUCKET || "review-images";
    const ext    = extFromMime(mimetype) || path.extname(originalName).replace(".", "") || "bin";
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const storagePath = `${folder}/${unique}.${ext}`;

    const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(storagePath, fileBuffer, {
            contentType:  mimetype,
            cacheControl: "3600",
            upsert:       false
        });

    if (uploadError) {
        const err = new Error("Image upload failed");
        err.details    = uploadError.message;
        err.statusCode = 500;
        throw err;
    }

    const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(storagePath);

    if (!urlData?.publicUrl) {
        const err = new Error("Could not retrieve uploaded image URL");
        err.statusCode = 500;
        throw err;
    }

    return urlData.publicUrl;
};

module.exports = { uploadImageToStorage };
