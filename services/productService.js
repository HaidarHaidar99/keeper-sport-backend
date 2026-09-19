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

// ── Admin: Create Product with Variants and Images ───────────────────────────
const createProduct = async (productData) => {
    const {
        name_en,
        name_ar,
        description_en,
        description_ar,
        category_id,
        base_price,
        is_sale_enabled = false,
        sale_price = null,
        is_featured = false,
        is_active = true,
        variants = [],
        images = []
    } = productData;

    if (!name_en || !name_ar || base_price === undefined || base_price === null) {
        const err = new Error("Product name (EN/AR) and base price are required");
        err.statusCode = 400;
        throw err;
    }

    // 1. Insert product record
    const { data: product, error: prodErr } = await supabase
        .from("products")
        .insert([{
            name_en: name_en.trim(),
            name_ar: name_ar.trim(),
            description_en: description_en || null,
            description_ar: description_ar || null,
            category_id: category_id || null,
            base_price: parseFloat(base_price),
            is_sale_enabled: Boolean(is_sale_enabled),
            sale_price: is_sale_enabled && sale_price !== null && !isNaN(sale_price) ? parseFloat(sale_price) : null,
            is_featured: Boolean(is_featured),
            is_active: Boolean(is_active)
        }])
        .select()
        .single();

    if (prodErr || !product) {
        const err = new Error("Failed to create product: " + (prodErr?.message || "Unknown error"));
        err.statusCode = 400;
        throw err;
    }

    // 2. Insert variants if provided
    if (Array.isArray(variants) && variants.length > 0) {
        const variantsPayload = variants.map((v) => ({
            product_id: product.id,
            size: v.size ? v.size.trim() : null,
            price: v.price !== undefined && v.price !== null && !isNaN(v.price) ? parseFloat(v.price) : null,
            track_quantity: v.track_quantity !== undefined ? Boolean(v.track_quantity) : true,
            physical_stock: Math.max(0, parseInt(v.physical_stock, 10) || 0)
        }));

        const { error: varErr } = await supabase
            .from("product_variants")
            .insert(variantsPayload);

        if (varErr) {
            console.error("Warning: Failed to insert product variants:", varErr);
        }
    }

    // 3. Insert images if provided (max 3 images)
    if (Array.isArray(images) && images.length > 0) {
        const imagesPayload = images.slice(0, 3).map((img, idx) => ({
            product_id: product.id,
            image_url: typeof img === 'string' ? img : img.image_url,
            display_order: idx + 1
        }));

        const { error: imgErr } = await supabase
            .from("product_images")
            .insert(imagesPayload);

        if (imgErr) {
            console.error("Warning: Failed to insert product images:", imgErr);
        }
    }

    return getProductById(product.id);
};

// ── Admin: Update Product, Variants & Images ─────────────────────────────────
const updateProduct = async (id, updateData) => {
    const {
        name_en,
        name_ar,
        description_en,
        description_ar,
        category_id,
        base_price,
        is_sale_enabled,
        sale_price,
        is_featured,
        is_active,
        variants,
        images
    } = updateData;

    const fieldsToUpdate = { updated_at: new Date().toISOString() };
    if (name_en !== undefined) fieldsToUpdate.name_en = name_en.trim();
    if (name_ar !== undefined) fieldsToUpdate.name_ar = name_ar.trim();
    if (description_en !== undefined) fieldsToUpdate.description_en = description_en;
    if (description_ar !== undefined) fieldsToUpdate.description_ar = description_ar;
    if (category_id !== undefined) fieldsToUpdate.category_id = category_id || null;
    if (base_price !== undefined) fieldsToUpdate.base_price = parseFloat(base_price);
    if (is_sale_enabled !== undefined) fieldsToUpdate.is_sale_enabled = Boolean(is_sale_enabled);
    if (sale_price !== undefined) {
        fieldsToUpdate.sale_price = (is_sale_enabled && sale_price !== null && !isNaN(sale_price)) ? parseFloat(sale_price) : null;
    }
    if (is_featured !== undefined) fieldsToUpdate.is_featured = Boolean(is_featured);
    if (is_active !== undefined) fieldsToUpdate.is_active = Boolean(is_active);

    const { error: prodErr } = await supabase
        .from("products")
        .update(fieldsToUpdate)
        .eq("id", id);

    if (prodErr) {
        const err = new Error("Failed to update product: " + prodErr.message);
        err.statusCode = 400;
        throw err;
    }

    // Replace variants if array provided
    if (Array.isArray(variants)) {
        await supabase.from("product_variants").delete().eq("product_id", id);
        if (variants.length > 0) {
            const variantsPayload = variants.map((v) => ({
                product_id: id,
                size: v.size ? v.size.trim() : null,
                price: v.price !== undefined && v.price !== null && !isNaN(v.price) ? parseFloat(v.price) : null,
                track_quantity: v.track_quantity !== undefined ? Boolean(v.track_quantity) : true,
                physical_stock: Math.max(0, parseInt(v.physical_stock, 10) || 0)
            }));
            await supabase.from("product_variants").insert(variantsPayload);
        }
    }

    // Replace images if array provided
    if (Array.isArray(images)) {
        await supabase.from("product_images").delete().eq("product_id", id);
        if (images.length > 0) {
            const imagesPayload = images.slice(0, 3).map((img, idx) => ({
                product_id: id,
                image_url: typeof img === 'string' ? img : img.image_url,
                display_order: idx + 1
            }));
            await supabase.from("product_images").insert(imagesPayload);
        }
    }

    return getProductById(id);
};

// ── Admin: Soft-delete / Deactivate Product ──────────────────────────────────
const deleteProduct = async (id) => {
    const { error } = await supabase
        .from("products")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id);

    if (error) {
        const err = new Error("Failed to deactivate product");
        err.details = error.message;
        throw err;
    }

    return { id, is_active: false };
};

module.exports = {
    getProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct
};
