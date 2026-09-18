const supabase = require("../config/supabase");

// ── Public Catalog Listing ────────────────────────────────────────────────────
// Delegates ALL filtering, sorting, and pagination to the PostgreSQL
// get_products_paginated() RPC function (defined in 03_phase2_corrections.sql).
// This ensures:
//   • Accurate pagination counts (no client-side post-filtering)
//   • in_stock and size filters applied in SQL via EXISTS subqueries
//   • best_seller, rating_asc, rating_desc sorts run in PostgreSQL
//   • Only the requested page of data is transferred over the wire
const getProducts = async (filters = {}) => {
    const {
        category_id,
        search,
        min_price,
        max_price,
        on_sale,
        in_stock,
        is_featured,
        size,
        sort  = "newest",
        page  = 1,
        limit = 12
    } = filters;

    // Sanitise and type-convert before passing to RPC
    const params = {
        p_category_id: category_id  || null,
        p_search:      (search && search.trim() !== "") ? search.trim() : null,
        p_min_price:   (min_price !== undefined && !isNaN(min_price))  ? parseFloat(min_price)  : null,
        p_max_price:   (max_price !== undefined && !isNaN(max_price))  ? parseFloat(max_price)  : null,
        p_on_sale:     (on_sale   === "true" || on_sale   === true)    ? true : null,
        p_in_stock:    (in_stock  === "true" || in_stock  === true)    ? true : null,
        p_is_featured: (is_featured !== undefined)
            ? (is_featured === "true" || is_featured === true)
            : null,
        p_size:        (size && size.trim() !== "") ? size.trim() : null,
        p_sort:        sort  || "newest",
        p_page:        Math.max(1, parseInt(page,  10) || 1),
        p_limit:       Math.min(50, Math.max(1, parseInt(limit, 10) || 12))
    };

    const { data, error } = await supabase.rpc("get_products_paginated", params);

    if (error) {
        const err = new Error("Failed to fetch products");
        err.details = error.message;
        throw err;
    }

    // The RPC returns { products: [...], pagination: { page, limit, totalItems, totalPages } }
    // productController expects the same shape: result.products + result.pagination
    return {
        products:   data?.products   || [],
        pagination: data?.pagination || {
            page:       params.p_page,
            limit:      params.p_limit,
            totalItems: 0,
            totalPages: 0
        }
    };
};

// ── Detailed Product View ─────────────────────────────────────────────────────
// Unchanged — single-product queries do not need the RPC.
const getProductById = async (id) => {
    const { data: product, error } = await supabase
        .from("products")
        .select(`
            id,
            category_id,
            name_en,
            name_ar,
            description_en,
            description_ar,
            base_price,
            is_sale_enabled,
            sale_price,
            is_featured,
            is_active,
            total_sold,
            created_at,
            categories (
                id,
                name_en,
                name_ar
            ),
            product_images (
                id,
                image_url,
                display_order
            ),
            product_variants (
                id,
                size,
                price,
                track_quantity,
                physical_stock,
                reserved_stock,
                available_stock,
                is_available
            )
        `)
        .eq("id", id)
        .eq("is_active", true)
        .single();

    if (error || !product) {
        const err = new Error("Product not found");
        err.statusCode = 404;
        throw err;
    }

    // Fetch approved reviews summary
    const { data: reviews } = await supabase
        .from("reviews")
        .select("rating")
        .eq("product_id", id)
        .eq("status", "approved");

    const reviewCount    = reviews?.length || 0;
    const averageRating  = reviewCount > 0
        ? parseFloat((reviews.reduce((acc, r) => acc + r.rating, 0) / reviewCount).toFixed(1))
        : null;

    // Sort images by display_order
    const sortedImages = (product.product_images || []).sort(
        (a, b) => a.display_order - b.display_order
    );

    return {
        ...product,
        product_images:  sortedImages,
        average_rating:  averageRating,
        review_count:    reviewCount
    };
};

module.exports = {
    getProducts,
    getProductById
};
