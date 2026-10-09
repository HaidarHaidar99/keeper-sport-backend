const supabase = require("../config/supabase");

/**
 * Helper to compute effective discount and current price
 */
const computeProductPricing = (product, activeOffersMap = new Map()) => {
  const basePrice = parseFloat(product.base_price) || 0;
  const oldPrice = product.old_price ? parseFloat(product.old_price) : null;

  // Check if product is tied to an active offer
  const directOffer = activeOffersMap.get(product.id);
  if (directOffer) {
    let discountedPrice = basePrice;
    let discountLabel = "";

    if (directOffer.discount_type === "percentage" && directOffer.discount_value) {
      const pct = parseFloat(directOffer.discount_value);
      discountedPrice = Math.max(0, basePrice * (1 - pct / 100));
      discountLabel = `${Math.round(pct)}% OFF`;
    } else if (directOffer.discount_type === "fixed" && directOffer.discount_value) {
      const fixed = parseFloat(directOffer.discount_value);
      discountedPrice = Math.max(0, basePrice - fixed);
      discountLabel = `$${fixed} OFF`;
    }

    return {
      currentPrice: parseFloat(discountedPrice.toFixed(2)),
      originalPrice: basePrice,
      hasDiscount: discountedPrice < basePrice,
      discountLabel,
      offerTitle: directOffer.title || null
    };
  }

  // Fallback to product.old_price if present and higher than base_price
  if (oldPrice && oldPrice > basePrice) {
    const diff = oldPrice - basePrice;
    const pct = Math.round((diff / oldPrice) * 100);
    return {
      currentPrice: basePrice,
      originalPrice: oldPrice,
      hasDiscount: true,
      discountLabel: `${pct}% OFF`,
      offerTitle: null
    };
  }

  return {
    currentPrice: basePrice,
    originalPrice: null,
    hasDiscount: false,
    discountLabel: null,
    offerTitle: null
  };
};

// In-memory cache for category lookups in product catalog
let cachedCategoriesData = { categoriesMap: null, categorySlugMap: null, timestamp: 0 };
const CATEGORIES_CACHE_TTL_MS = 60 * 1000;

const getCachedCategories = async () => {
  const now = Date.now();
  if (cachedCategoriesData.categoriesMap && now - cachedCategoriesData.timestamp < CATEGORIES_CACHE_TTL_MS) {
    return cachedCategoriesData;
  }
  const { data: allCategories } = await supabase
    .from("categories")
    .select("id, name, slug")
    .eq("is_active", true);

  const categoriesMap = new Map((allCategories || []).map((c) => [c.id, c]));
  const categorySlugMap = new Map((allCategories || []).map((c) => [c.slug, c.id]));
  cachedCategoriesData = { categoriesMap, categorySlugMap, timestamp: now };
  return cachedCategoriesData;
};

/**
 * Get Products Catalog with search, filters, sorting, and pagination
 * GET /api/products
 */
const getProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      category,
      featured,
      search,
      in_stock,
      on_sale,
      min_price,
      max_price,
      sort = "featured"
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(48, parseInt(limit, 10) || 12));
    const offset = (pageNum - 1) * limitNum;

    // 1. Standard low stock threshold constant from application domain
    const lowStockThreshold = 5;

    // 2. Fetch categories map (cached in-memory)
    const { categoriesMap, categorySlugMap } = await getCachedCategories();

    // 3. Resolve category filter if passed as slug, id, or name
    let filterCategoryId = null;
    if (category && typeof category === "string") {
      const cleanCat = category.trim();
      if (categorySlugMap.has(cleanCat)) {
        filterCategoryId = categorySlugMap.get(cleanCat);
      } else if (categorySlugMap.has(cleanCat.toLowerCase())) {
        filterCategoryId = categorySlugMap.get(cleanCat.toLowerCase());
      } else if (categoriesMap.has(cleanCat)) {
        filterCategoryId = cleanCat;
      } else {
        for (const [id, c] of categoriesMap.entries()) {
          if (
            (c.slug && c.slug.toLowerCase() === cleanCat.toLowerCase()) ||
            (c.name && c.name.toLowerCase() === cleanCat.toLowerCase())
          ) {
            filterCategoryId = id;
            break;
          }
        }
      }
    }

    // 4. Build base query for products
    let query = supabase
      .from("products")
      .select(
        "id, category_id, name, slug, brand, description, base_price, old_price, stock_quantity, is_premium, is_active, is_featured, is_best_seller, is_new_arrival, printing_available, badges_available, created_at",
        { count: "exact" }
      )
      .eq("is_active", true);

    if (category) {
      if (filterCategoryId) {
        query = query.eq("category_id", filterCategoryId);
      } else {
        // Category was requested but does not exist - filter to impossible id so 0 products returned
        query = query.eq("category_id", "00000000-0000-0000-0000-000000000000");
      }
    }

    if (featured === "true" || featured === true) {
      query = query.eq("is_featured", true);
    }

    if (in_stock === "true" || in_stock === true) {
      query = query.gt("stock_quantity", 0);
    }

    if (min_price && !isNaN(parseFloat(min_price))) {
      query = query.gte("base_price", parseFloat(min_price));
    }

    if (max_price && !isNaN(parseFloat(max_price))) {
      query = query.lte("base_price", parseFloat(max_price));
    }

    if (search && search.trim()) {
      const term = search.trim();
      query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%,brand.ilike.%${term}%`);
    }

    // Sorting
    switch (sort) {
      case "price_asc":
        query = query.order("base_price", { ascending: true });
        break;
      case "price_desc":
        query = query.order("base_price", { ascending: false });
        break;
      case "newest":
        query = query.order("created_at", { ascending: false });
        break;
      case "featured":
      default:
        query = query
          .order("is_featured", { ascending: false })
          .order("created_at", { ascending: false });
        break;
    }

    // Pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: rawProducts, count: totalCount, error } = await query;

    if (error) {
      console.error("Error querying products:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to query products catalog.",
        error: error.message
      });
    }

    const total = totalCount || 0;
    const productsList = rawProducts || [];

    if (productsList.length === 0) {
      return res.json({
        success: true,
        products: [],
        total: 0,
        page: pageNum,
        limit: limitNum,
        totalPages: 0,
        hasMore: false,
        lowStockThreshold
      });
    }

    const productIds = productsList.map((p) => p.id);

    // 5. Query relations in parallel: Media, Ratings, Active Offers, User Favorites
    const now = new Date().toISOString();
    const userId = req.user?.id || null;

    const [mediaRes, ratingsRes, offerProdsRes, favRes] = await Promise.all([
      // Media
      supabase
        .from("product_media")
        .select("id, product_id, media_type, storage_path, alt_text, is_cover, sort_order")
        .in("product_id", productIds)
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true }),

      // Rating summary
      supabase
        .from("product_rating_summary")
        .select("product_id, average_rating, ratings_count")
        .in("product_id", productIds),

      // Offer links
      supabase
        .from("offer_products")
        .select("offer_id, product_id, offers(id, title, discount_type, discount_value, starts_at, ends_at, is_visible)")
        .in("product_id", productIds),

      // Favorites for user
      userId
        ? supabase.from("favorites").select("product_id").eq("user_id", userId).in("product_id", productIds)
        : Promise.resolve({ data: [] })
    ]);

    // Map media by product
    const mediaMap = new Map();
    (mediaRes.data || []).forEach((m) => {
      if (!mediaMap.has(m.product_id)) {
        mediaMap.set(m.product_id, []);
      }
      mediaMap.get(m.product_id).push(m);
    });

    // Map ratings by product
    const ratingsMap = new Map(
      (ratingsRes.data || []).map((r) => [r.product_id, r])
    );

    // Map active offers by product
    const activeOffersMap = new Map();
    (offerProdsRes.data || []).forEach((op) => {
      const o = op.offers;
      if (o && o.is_visible) {
        if (o.starts_at && new Date(o.starts_at) > new Date(now)) return;
        if (o.ends_at && new Date(o.ends_at) < new Date(now)) return;
        activeOffersMap.set(op.product_id, o);
      }
    });

    // Map favorites set
    const userFavoritesSet = new Set((favRes.data || []).map((f) => f.product_id));

    // 6. Format final products
    let formatted = productsList.map((p) => {
      const media = mediaMap.get(p.id) || [];
      const primaryMedia = media.find((m) => m.is_cover) || media[0] || null;
      const ratingInfo = ratingsMap.get(p.id) || null;
      const pricing = computeProductPricing(p, activeOffersMap);
      const categoryObj = categoriesMap.get(p.category_id) || null;

      const stockQty = p.stock_quantity || 0;
      let stockStatus = "in_stock";
      if (stockQty <= 0) {
        stockStatus = "out_of_stock";
      } else if (stockQty <= lowStockThreshold) {
        stockStatus = "low_stock";
      }

      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        brand: p.brand,
        description: p.description,
        category: categoryObj ? { id: categoryObj.id, name: categoryObj.name, slug: categoryObj.slug } : null,
        media,
        primaryImage: primaryMedia ? primaryMedia.storage_path : null,
        primaryImageAlt: primaryMedia ? primaryMedia.alt_text || p.name : p.name,
        pricing,
        stock: {
          quantity: stockQty,
          status: stockStatus,
          isLowStock: stockStatus === "low_stock",
          isOutOfStock: stockStatus === "out_of_stock"
        },
        rating: {
          average: ratingInfo ? parseFloat(ratingInfo.average_rating) : null,
          count: ratingInfo ? parseInt(ratingInfo.ratings_count, 10) : 0
        },
        isFeatured: Boolean(p.is_featured),
        isPremium: Boolean(p.is_premium),
        isBestSeller: Boolean(p.is_best_seller),
        isNewArrival: Boolean(p.is_new_arrival),
        isFavorited: userFavoritesSet.has(p.id),
        printingAvailable: Boolean(p.printing_available),
        badgesAvailable: Boolean(p.badges_available),
        createdAt: p.created_at
      };
    });

    // Handle on_sale filter if requested
    if (on_sale === "true" || on_sale === true) {
      formatted = formatted.filter((p) => p.pricing.hasDiscount);
    }

    const totalPages = Math.ceil(total / limitNum);

    return res.json({
      success: true,
      products: formatted,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages,
      hasMore: pageNum < totalPages,
      lowStockThreshold
    });
  } catch (err) {
    console.error("Unexpected error in getProducts:", err);
    return res.status(500).json({
      success: false,
      message: "Server error querying products."
    });
  }
};

/**
 * Get Featured Products Rail (Dynamic, configured by is_featured = true)
 * GET /api/products/featured
 */
const getFeaturedProducts = async (req, res) => {
  try {
    const { limit = 8 } = req.query;
    const limitNum = Math.max(1, Math.min(20, parseInt(limit, 10) || 8));

    // Standard low stock threshold constant
    const lowStockThreshold = 5;

    // Fetch active categories
    const { data: allCategories } = await supabase
      .from("categories")
      .select("id, name, slug")
      .eq("is_active", true);

    const categoriesMap = new Map((allCategories || []).map((c) => [c.id, c]));

    // Query featured products
    const { data: rawProducts, error } = await supabase
      .from("products")
      .select("id, category_id, name, slug, brand, description, base_price, old_price, stock_quantity, is_premium, is_active, is_featured, is_best_seller, is_new_arrival, printing_available, badges_available, created_at")
      .eq("is_active", true)
      .eq("is_featured", true)
      .order("created_at", { ascending: false })
      .limit(limitNum);

    if (error) {
      console.error("Error fetching featured products:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch featured products."
      });
    }

    const productsList = rawProducts || [];
    if (productsList.length === 0) {
      return res.json({
        success: true,
        products: []
      });
    }

    const productIds = productsList.map((p) => p.id);
    const userId = req.user?.id || null;
    const now = new Date().toISOString();

    const [mediaRes, ratingsRes, offerProdsRes, favRes] = await Promise.all([
      supabase
        .from("product_media")
        .select("id, product_id, media_type, storage_path, alt_text, is_cover, sort_order")
        .in("product_id", productIds)
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true }),

      supabase
        .from("product_rating_summary")
        .select("product_id, average_rating, ratings_count")
        .in("product_id", productIds),

      supabase
        .from("offer_products")
        .select("offer_id, product_id, offers(id, title, discount_type, discount_value, starts_at, ends_at, is_visible)")
        .in("product_id", productIds),

      userId
        ? supabase.from("favorites").select("product_id").eq("user_id", userId).in("product_id", productIds)
        : Promise.resolve({ data: [] })
    ]);

    const mediaMap = new Map();
    (mediaRes.data || []).forEach((m) => {
      if (!mediaMap.has(m.product_id)) mediaMap.set(m.product_id, []);
      mediaMap.get(m.product_id).push(m);
    });

    const ratingsMap = new Map((ratingsRes.data || []).map((r) => [r.product_id, r]));

    const activeOffersMap = new Map();
    (offerProdsRes.data || []).forEach((op) => {
      const o = op.offers;
      if (o && o.is_visible) {
        if (o.starts_at && new Date(o.starts_at) > new Date(now)) return;
        if (o.ends_at && new Date(o.ends_at) < new Date(now)) return;
        activeOffersMap.set(op.product_id, o);
      }
    });

    const userFavoritesSet = new Set((favRes.data || []).map((f) => f.product_id));

    const formatted = productsList.map((p) => {
      const media = mediaMap.get(p.id) || [];
      const primaryMedia = media.find((m) => m.is_cover) || media[0] || null;
      const ratingInfo = ratingsMap.get(p.id) || null;
      const pricing = computeProductPricing(p, activeOffersMap);
      const categoryObj = categoriesMap.get(p.category_id) || null;

      const stockQty = p.stock_quantity || 0;
      let stockStatus = "in_stock";
      if (stockQty <= 0) stockStatus = "out_of_stock";
      else if (stockQty <= lowStockThreshold) stockStatus = "low_stock";

      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        brand: p.brand,
        description: p.description,
        category: categoryObj ? { id: categoryObj.id, name: categoryObj.name, slug: categoryObj.slug } : null,
        media,
        primaryImage: primaryMedia ? primaryMedia.storage_path : null,
        primaryImageAlt: primaryMedia ? primaryMedia.alt_text || p.name : p.name,
        pricing,
        stock: {
          quantity: stockQty,
          status: stockStatus,
          isLowStock: stockStatus === "low_stock",
          isOutOfStock: stockStatus === "out_of_stock"
        },
        rating: {
          average: ratingInfo ? parseFloat(ratingInfo.average_rating) : null,
          count: ratingInfo ? parseInt(ratingInfo.ratings_count, 10) : 0
        },
        isFeatured: true,
        isPremium: Boolean(p.is_premium),
        isBestSeller: Boolean(p.is_best_seller),
        isNewArrival: Boolean(p.is_new_arrival),
        isFavorited: userFavoritesSet.has(p.id),
        printingAvailable: Boolean(p.printing_available),
        badgesAvailable: Boolean(p.badges_available),
        createdAt: p.created_at
      };
    });

    return res.json({
      success: true,
      products: formatted
    });
  } catch (err) {
    console.error("Unexpected error in getFeaturedProducts:", err);
    return res.status(500).json({
      success: false,
      message: "Server error querying featured products."
    });
  }
};

/**
 * Get Single Product Details by Slug or ID
 * GET /api/products/:slugOrId
 */
const getProductBySlugOrId = async (req, res) => {
  try {
    const { slugOrId } = req.params;

    // Check if UUID vs slug
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);

    let query = supabase
      .from("products")
      .select("id, category_id, name, slug, brand, description, base_price, old_price, stock_quantity, is_premium, is_active, is_featured, is_best_seller, is_new_arrival, printing_available, badges_available, created_at");

    if (isUuid) {
      query = query.eq("id", slugOrId);
    } else {
      query = query.eq("slug", slugOrId);
    }

    const { data: product, error } = await query.maybeSingle();

    if (error || !product) {
      return res.status(404).json({
        success: false,
        message: "Product not found."
      });
    }

    // Fetch media, variants, category, rating, reviews
    const [mediaRes, variantsRes, catRes, ratingRes, reviewsRes] = await Promise.all([
      supabase.from("product_media").select("*").eq("product_id", product.id).order("sort_order", { ascending: true }),
      supabase.from("product_variants").select("*").eq("product_id", product.id).eq("is_active", true).order("sort_order", { ascending: true }),
      supabase.from("categories").select("id, name, slug").eq("id", product.category_id).maybeSingle(),
      supabase.from("product_rating_summary").select("average_rating, ratings_count").eq("product_id", product.id).maybeSingle(),
      supabase.from("product_reviews").select("id, rating, review_text, created_at, user_id").eq("product_id", product.id).eq("is_visible", true).order("created_at", { ascending: false }).limit(20)
    ]);

    const lowStockThreshold = 5;
    const pricing = computeProductPricing(product);

    const stockQty = product.stock_quantity || 0;
    let stockStatus = "in_stock";
    if (stockQty <= 0) stockStatus = "out_of_stock";
    else if (stockQty <= lowStockThreshold) stockStatus = "low_stock";

    return res.json({
      success: true,
      product: {
        ...product,
        category: catRes.data || null,
        media: mediaRes.data || [],
        variants: variantsRes.data || [],
        pricing,
        stock: {
          quantity: stockQty,
          status: stockStatus,
          isLowStock: stockStatus === "low_stock",
          isOutOfStock: stockStatus === "out_of_stock"
        },
        rating: {
          average: ratingRes.data ? parseFloat(ratingRes.data.average_rating) : null,
          count: ratingRes.data ? parseInt(ratingRes.data.ratings_count, 10) : 0
        },
        reviews: reviewsRes.data || []
      }
    });
  } catch (err) {
    console.error("Unexpected error in getProductBySlugOrId:", err);
    return res.status(500).json({
      success: false,
      message: "Server error querying product details."
    });
  }
};

module.exports = {
  getProducts,
  getFeaturedProducts,
  getProductBySlugOrId
};
