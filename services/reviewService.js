const supabase = require("../config/supabase");

// Public Approved Reviews (Optionally filtered by product)
const getApprovedReviews = async ({ productId = null, page = 1, limit = 10 } = {}) => {
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
        .from("reviews")
        .select(`
            id,
            product_id,
            customer_name,
            rating,
            title,
            description,
            created_at,
            products (
                id,
                name_en,
                name_ar
            ),
            review_images (
                id,
                image_url
            )
        `, { count: "exact" })
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .range(offset, offset + limitNum - 1);

    if (productId) {
        query = query.eq("product_id", productId);
    }

    const { data, count, error } = await query;

    if (error) {
        const err = new Error("Failed to fetch reviews");
        err.details = error.message;
        throw err;
    }

    return {
        reviews: data || [],
        pagination: {
            page: pageNum,
            limit: limitNum,
            totalItems: count || 0,
            totalPages: Math.ceil((count || 0) / limitNum)
        }
    };
};

// Submit Review (Open to all customers/guests; min 1 image required; pending by default)
const submitReview = async ({ productId, customerName, rating, title, description, imageUrls }) => {
    const numRating = parseInt(rating, 10);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
        const err = new Error("Rating must be an integer between 1 and 5");
        err.statusCode = 400;
        throw err;
    }

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
        const err = new Error("At least one product review photo is required");
        err.statusCode = 400;
        throw err;
    }

    // Insert review record
    const { data: review, error: revErr } = await supabase
        .from("reviews")
        .insert([{
            product_id: productId,
            customer_name: customerName.trim(),
            rating: numRating,
            title: title.trim(),
            description: description.trim(),
            status: "pending" // Moderation queue
        }])
        .select()
        .single();

    if (revErr) {
        const err = new Error("Failed to submit review");
        err.details = revErr.message;
        throw err;
    }

    // Insert review images
    const imagesPayload = imageUrls.map(url => ({
        review_id: review.id,
        image_url: url
    }));

    await supabase.from("review_images").insert(imagesPayload);

    return review;
};

// Admin Moderation Queue
const getAdminReviews = async ({ status = "pending", page = 1, limit = 20 } = {}) => {
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
        .from("reviews")
        .select(`
            id,
            product_id,
            customer_name,
            rating,
            title,
            description,
            status,
            created_at,
            products (
                id,
                name_en
            ),
            review_images (
                id,
                image_url
            )
        `, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limitNum - 1);

    if (status) {
        query = query.eq("status", status);
    }

    const { data, count, error } = await query;

    if (error) {
        const err = new Error("Failed to fetch admin reviews");
        err.details = error.message;
        throw err;
    }

    return {
        reviews: data || [],
        pagination: {
            page: pageNum,
            limit: limitNum,
            totalItems: count || 0,
            totalPages: Math.ceil((count || 0) / limitNum)
        }
    };
};

// Admin Approve / Decline Review
const updateReviewStatus = async (reviewId, status) => {
    if (!["approved", "declined"].includes(status)) {
        const err = new Error("Status must be either 'approved' or 'declined'");
        err.statusCode = 400;
        throw err;
    }

    const { data, error } = await supabase
        .from("reviews")
        .update({
            status,
            updated_at: new Date().toISOString()
        })
        .eq("id", reviewId)
        .select()
        .single();

    if (error) {
        const err = new Error("Failed to update review status");
        err.details = error.message;
        throw err;
    }

    return data;
};

module.exports = {
    getApprovedReviews,
    submitReview,
    getAdminReviews,
    updateReviewStatus
};
