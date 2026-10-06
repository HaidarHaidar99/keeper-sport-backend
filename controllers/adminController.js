const crypto = require("crypto");
const supabase = require("../config/supabase");

const BUCKET_NAME = "keeper-media";

/**
 * Helper: ensure Supabase storage bucket exists
 */
const ensureStorageBucket = async () => {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = (buckets || []).some((b) => b.name === BUCKET_NAME);
    if (!exists) {
      await supabase.storage.createBucket(BUCKET_NAME, { public: true });
    }
  } catch (err) {
    console.warn("Storage bucket check warning:", err.message);
  }
};

/**
 * Helper: generate slug
 */
const slugify = (text) => {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

// =============================================================================
// 1. DASHBOARD OVERVIEW & STATS
// =============================================================================

/**
 * GET /api/admin/dashboard
 */
const getDashboardOverview = async (req, res) => {
  try {
    // Standard low stock threshold constant
    const lowStockThreshold = 5;

    // Run parallel count and aggregate queries
    const [
      usersCountRes,
      ordersCountRes,
      productsCountRes,
      activeProductsRes,
      lowStockProductsRes,
      outOfStockProductsRes,
      unreadNotifRes,
      reviewsCountRes,
      recentOrdersRes,
      recentUsersRes,
      lowStockItemsRes,
      recentNotifsRes
    ] = await Promise.all([
      // Total Users
      supabase.from("users").select("id", { count: "exact", head: true }),
      // Total Orders
      supabase.from("orders").select("id", { count: "exact", head: true }),
      // Total Products
      supabase.from("products").select("id", { count: "exact", head: true }),
      // Active Products
      supabase.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
      // Low Stock Products
      supabase.from("products").select("id", { count: "exact", head: true }).eq("is_active", true).gt("stock_quantity", 0).lte("stock_quantity", lowStockThreshold),
      // Out of Stock Products
      supabase.from("products").select("id", { count: "exact", head: true }).eq("is_active", true).lte("stock_quantity", 0),
      // Unread Admin Notifications
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_type", "admin").eq("is_read", false),
      // Total Reviews
      supabase.from("product_reviews").select("id", { count: "exact", head: true }),
      // Recent Orders (limit 5)
      supabase.from("orders").select("id, order_number, customer_full_name, total, status, payment_method, created_at").order("created_at", { ascending: false }).limit(5),
      // Recent Users (limit 5)
      supabase.from("users").select("id, full_name, email, role, is_verified, created_at").order("created_at", { ascending: false }).limit(5),
      // Low stock product items
      supabase.from("products").select("id, name, slug, stock_quantity, base_price, is_active").lte("stock_quantity", lowStockThreshold).order("stock_quantity", { ascending: true }).limit(6),
      // Recent notifications (limit 5)
      supabase.from("notifications").select("id, title, message, type, is_read, created_at").eq("recipient_type", "admin").order("created_at", { ascending: false }).limit(5)
    ]);

    return res.json({
      success: true,
      stats: {
        totalUsers: usersCountRes.count || 0,
        totalOrders: ordersCountRes.count || 0,
        totalProducts: productsCountRes.count || 0,
        activeProducts: activeProductsRes.count || 0,
        lowStockProducts: lowStockProductsRes.count || 0,
        outOfStockProducts: outOfStockProductsRes.count || 0,
        unreadNotifications: unreadNotifRes.count || 0,
        totalReviews: reviewsCountRes.count || 0,
        lowStockThreshold
      },
      recentOrders: recentOrdersRes.data || [],
      recentUsers: recentUsersRes.data || [],
      lowStockItems: lowStockItemsRes.data || [],
      recentNotifications: recentNotifsRes.data || []
    });
  } catch (err) {
    console.error("Dashboard overview error:", err);
    return res.status(500).json({ success: false, message: "Error fetching dashboard overview." });
  }
};

// =============================================================================
// 2. MEDIA UPLOAD
// =============================================================================

/**
 * POST /api/admin/upload
 * Uses multer memoryStorage buffer
 */
const uploadMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file provided for upload." });
    }

    await ensureStorageBucket();

    const file = req.file;
    const fileExt = file.originalname.split(".").pop();
    const cleanFileName = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}.${fileExt}`;
    const filePath = `uploads/${cleanFileName}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (uploadError) {
      console.error("Supabase storage upload error:", uploadError);
      return res.status(500).json({ success: false, message: uploadError.message });
    }

    const { data: publicData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath);

    return res.json({
      success: true,
      url: publicData.publicUrl,
      path: filePath,
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size
    });
  } catch (err) {
    console.error("Media upload error:", err);
    return res.status(500).json({ success: false, message: "Internal server error during upload." });
  }
};

// =============================================================================
// 3. HOME MANAGEMENT: HERO SLIDES & OFFER BARS
// =============================================================================

/**
 * GET /api/admin/home/overview
 */
const getHomeOverview = async (req, res) => {
  try {
    const [heroCount, activeHeroCount, offersCount, activeOffersCount] = await Promise.all([
      supabase.from("hero_slides").select("id", { count: "exact", head: true }),
      supabase.from("hero_slides").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("offer_bars").select("id", { count: "exact", head: true }),
      supabase.from("offer_bars").select("id", { count: "exact", head: true }).eq("is_active", true)
    ]);

    return res.json({
      success: true,
      stats: {
        totalSlides: heroCount.count || 0,
        activeSlides: activeHeroCount.count || 0,
        totalOffers: offersCount.count || 0,
        activeOffers: activeOffersCount.count || 0
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/admin/hero-slides
 */
const getHeroSlidesAdmin = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("hero_slides")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) throw error;
    return res.json({ success: true, slides: data || [] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/admin/hero-slides
 */
const createHeroSlide = async (req, res) => {
  try {
    const {
      title,
      subtitle,
      media_type = "image",
      media_path,
      fallback_image_path,
      primary_button_text,
      primary_button_route,
      secondary_button_text,
      secondary_button_route,
      duration_seconds = 5,
      sort_order = 0,
      is_active = true
    } = req.body;

    if (!media_path || !media_path.trim()) {
      return res.status(400).json({ success: false, message: "Media path/URL is required." });
    }

    const safeMediaType = media_type === "video" ? "video" : "image";
    const safeDuration = Math.max(1, parseInt(duration_seconds, 10) || 5);
    const safeSortOrder = Math.max(0, parseInt(sort_order, 10) || 0);

    const { data, error } = await supabase
      .from("hero_slides")
      .insert({
        title: title ? title.trim() : null,
        subtitle: subtitle ? subtitle.trim() : null,
        media_type: safeMediaType,
        media_path: media_path.trim(),
        fallback_image_path: fallback_image_path ? fallback_image_path.trim() : null,
        primary_button_text: primary_button_text ? primary_button_text.trim() : null,
        primary_button_route: primary_button_route ? primary_button_route.trim() : null,
        secondary_button_text: secondary_button_text ? secondary_button_text.trim() : null,
        secondary_button_route: secondary_button_route ? secondary_button_route.trim() : null,
        duration_seconds: safeDuration,
        sort_order: safeSortOrder,
        is_active: Boolean(is_active)
      })
      .select("*")
      .single();

    if (error) {
      console.error("createHeroSlide error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
    return res.json({ success: true, slide: data, message: "Hero slide created successfully." });
  } catch (err) {
    console.error("createHeroSlide catch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/admin/hero-slides/:id
 */
const updateHeroSlide = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      subtitle,
      media_type,
      media_path,
      fallback_image_path,
      primary_button_text,
      primary_button_route,
      secondary_button_text,
      secondary_button_route,
      duration_seconds,
      sort_order,
      is_active
    } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title ? title.trim() : null;
    if (subtitle !== undefined) updates.subtitle = subtitle ? subtitle.trim() : null;
    if (media_type !== undefined) updates.media_type = media_type === "video" ? "video" : "image";
    if (media_path !== undefined) updates.media_path = media_path ? media_path.trim() : null;
    if (fallback_image_path !== undefined) updates.fallback_image_path = fallback_image_path ? fallback_image_path.trim() : null;
    if (primary_button_text !== undefined) updates.primary_button_text = primary_button_text ? primary_button_text.trim() : null;
    if (primary_button_route !== undefined) updates.primary_button_route = primary_button_route ? primary_button_route.trim() : null;
    if (secondary_button_text !== undefined) updates.secondary_button_text = secondary_button_text ? secondary_button_text.trim() : null;
    if (secondary_button_route !== undefined) updates.secondary_button_route = secondary_button_route ? secondary_button_route.trim() : null;
    if (duration_seconds !== undefined) updates.duration_seconds = Math.max(1, parseInt(duration_seconds, 10) || 5);
    if (sort_order !== undefined) updates.sort_order = Math.max(0, parseInt(sort_order, 10) || 0);
    if (is_active !== undefined) updates.is_active = Boolean(is_active);

    const { data, error } = await supabase
      .from("hero_slides")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error("updateHeroSlide error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
    return res.json({ success: true, slide: data, message: "Hero slide updated successfully." });
  } catch (err) {
    console.error("updateHeroSlide catch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/admin/hero-slides/:id
 */
const deleteHeroSlide = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from("hero_slides").delete().eq("id", id);
    if (error) {
      console.error("deleteHeroSlide error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
    return res.json({ success: true, message: "Hero slide deleted successfully." });
  } catch (err) {
    console.error("deleteHeroSlide catch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/admin/offer-bars
 */
const getOfferBarsAdmin = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("offer_bars")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) throw error;
    return res.json({ success: true, offers: data || [] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/admin/offer-bars
 */
const createOfferBar = async (req, res) => {
  try {
    const { text, route, duration_seconds = 4, is_active = true, sort_order = 0, starts_at, ends_at } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: "Offer bar announcement text is required." });
    }

    const safeStartsAt = starts_at && typeof starts_at === 'string' && starts_at.trim() ? starts_at.trim() : null;
    const safeEndsAt = ends_at && typeof ends_at === 'string' && ends_at.trim() ? ends_at.trim() : null;
    const safeDuration = Math.max(1, parseInt(duration_seconds, 10) || 4);
    const safeSortOrder = Math.max(0, parseInt(sort_order, 10) || 0);

    const { data, error } = await supabase
      .from("offer_bars")
      .insert({
        text: text.trim(),
        route: route && route.trim() ? route.trim() : null,
        duration_seconds: safeDuration,
        sort_order: safeSortOrder,
        is_active: Boolean(is_active),
        starts_at: safeStartsAt,
        ends_at: safeEndsAt
      })
      .select("*")
      .single();

    if (error) {
      console.error("createOfferBar error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
    return res.json({ success: true, offer: data, message: "Offer bar created successfully." });
  } catch (err) {
    console.error("createOfferBar catch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/admin/offer-bars/:id
 */
const updateOfferBar = async (req, res) => {
  try {
    const { id } = req.params;
    const { text, route, duration_seconds, is_active, sort_order, starts_at, ends_at } = req.body;

    const updates = {};
    if (text !== undefined) updates.text = text.trim();
    if (route !== undefined) updates.route = route && route.trim() ? route.trim() : null;
    if (duration_seconds !== undefined) updates.duration_seconds = Math.max(1, parseInt(duration_seconds, 10) || 4);
    if (sort_order !== undefined) updates.sort_order = Math.max(0, parseInt(sort_order, 10) || 0);
    if (is_active !== undefined) updates.is_active = Boolean(is_active);
    if (starts_at !== undefined) updates.starts_at = starts_at && typeof starts_at === 'string' && starts_at.trim() ? starts_at.trim() : null;
    if (ends_at !== undefined) updates.ends_at = ends_at && typeof ends_at === 'string' && ends_at.trim() ? ends_at.trim() : null;

    const { data, error } = await supabase
      .from("offer_bars")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error("updateOfferBar error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
    return res.json({ success: true, offer: data, message: "Offer bar updated successfully." });
  } catch (err) {
    console.error("updateOfferBar catch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/admin/offer-bars/:id
 */
const deleteOfferBar = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from("offer_bars").delete().eq("id", id);
    if (error) throw error;
    return res.json({ success: true, message: "Offer bar deleted successfully." });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// =============================================================================
// 4. SITE SETTINGS & BRANDING MANAGEMENT
// =============================================================================

/**
 * GET /api/admin/settings
 */
const getSiteSettingsAdmin = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("site_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (error) throw error;
    return res.json({ success: true, settings: data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/admin/settings
 */
const updateSiteSettingsAdmin = async (req, res) => {
  try {
    const allowedKeys = [
      "site_name",
      "logo_path",
      "favicon_path",
      "phone_number",
      "email",
      "whatsapp_number",
      "instagram_url",
      "facebook_url",
      "tiktok_url",
      "x_url",
      "location_name",
      "location_url",
      "about_us",
      "seo_title",
      "seo_description",
      "seo_keywords",
      "delivery_fee",
      "printing_price",
      "badge_price",
      "premier_league_badge_available",
      "champions_league_badge_available",
      "la_liga_badge_available"
    ];

    const updates = {};
    for (const key of allowedKeys) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    if (updates.delivery_fee !== undefined) {
      updates.delivery_fee = parseFloat(updates.delivery_fee) || 0;
    }
    if (updates.printing_price !== undefined) {
      updates.printing_price = parseFloat(updates.printing_price) || 0;
    }
    if (updates.badge_price !== undefined) {
      updates.badge_price = parseFloat(updates.badge_price) || 0;
    }

    const { data, error } = await supabase
      .from("site_settings")
      .update(updates)
      .eq("id", 1)
      .select("*")
      .single();

    if (error) {
      console.error("updateSiteSettingsAdmin database error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, settings: data, message: "Site settings updated successfully." });
  } catch (err) {
    console.error("updateSiteSettingsAdmin unexpected error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// =============================================================================
// 5. PRODUCTS MANAGEMENT
// =============================================================================

/**
 * GET /api/admin/products/overview
 */
const getProductsOverview = async (req, res) => {
  try {
    const lowStockThreshold = 5;

    const [totalRes, activeRes, outRes, lowRes, featuredRes] = await Promise.all([
      supabase.from("products").select("id", { count: "exact", head: true }),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("products").select("id", { count: "exact", head: true }).lte("stock_quantity", 0),
      supabase.from("products").select("id", { count: "exact", head: true }).gt("stock_quantity", 0).lte("stock_quantity", lowStockThreshold),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("is_featured", true)
    ]);

    return res.json({
      success: true,
      stats: {
        total: totalRes.count || 0,
        active: activeRes.count || 0,
        outOfStock: outRes.count || 0,
        lowStock: lowRes.count || 0,
        featured: featuredRes.count || 0,
        lowStockThreshold
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/admin/products
 */
const getProductsAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 15, search, category, status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 15));
    const offset = (pageNum - 1) * limitNum;

    const lowStockThreshold = 5;

    let query = supabase
      .from("products")
      .select(`
        id,
        category_id,
        name,
        slug,
        brand,
        description,
        base_price,
        old_price,
        stock_quantity,
        is_premium,
        is_active,
        is_featured,
        is_best_seller,
        is_new_arrival,
        created_at,
        categories (id, name, slug)
      `, { count: "exact" });

    if (search && search.trim()) {
      const term = search.trim();
      query = query.or(`name.ilike.%${term}%,brand.ilike.%${term}%,description.ilike.%${term}%`);
    }

    if (category) {
      query = query.eq("category_id", category);
    }

    if (status === "active") {
      query = query.eq("is_active", true);
    } else if (status === "inactive") {
      query = query.eq("is_active", false);
    } else if (status === "low_stock") {
      query = query.gt("stock_quantity", 0).lte("stock_quantity", lowStockThreshold);
    } else if (status === "out_of_stock") {
      query = query.lte("stock_quantity", 0);
    } else if (status === "featured") {
      query = query.eq("is_featured", true);
    }

    query = query.order("created_at", { ascending: false }).range(offset, offset + limitNum - 1);

    const { data: rawProducts, count: totalCount, error } = await query;
    if (error) throw error;

    const productIds = (rawProducts || []).map((p) => p.id);
    let mediaMap = new Map();

    if (productIds.length > 0) {
      const { data: media } = await supabase
        .from("product_media")
        .select("id, product_id, storage_path, is_cover")
        .in("product_id", productIds)
        .order("is_cover", { ascending: false });

      (media || []).forEach((m) => {
        if (!mediaMap.has(m.product_id)) mediaMap.set(m.product_id, m.storage_path);
      });
    }

    const formatted = (rawProducts || []).map((p) => ({
      ...p,
      categoryName: p.categories?.name || "Uncategorized",
      primaryImage: mediaMap.get(p.id) || null,
      isLowStock: p.stock_quantity > 0 && p.stock_quantity <= lowStockThreshold,
      isOutOfStock: p.stock_quantity <= 0
    }));

    const total = totalCount || 0;
    const totalPages = Math.ceil(total / limitNum);

    return res.json({
      success: true,
      products: formatted,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages,
      hasMore: pageNum < totalPages
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/admin/products/:id
 */
const getProductByIdAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: product, error } = await supabase
      .from("products")
      .select("*, categories(id, name, slug)")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }

    const [mediaRes, variantsRes] = await Promise.all([
      supabase
        .from("product_media")
        .select("*")
        .eq("product_id", id)
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true }),
      supabase
        .from("product_variants")
        .select("*")
        .eq("product_id", id)
        .order("sort_order", { ascending: true })
    ]);

    return res.json({
      success: true,
      product: {
        ...product,
        media: mediaRes.data || [],
        variants: variantsRes.data || []
      }
    });
  } catch (err) {
    console.error("getProductByIdAdmin error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/admin/products
 */
const createProduct = async (req, res) => {
  try {
    const {
      name,
      category_id,
      brand,
      description,
      base_price,
      old_price,
      stock_quantity = 0,
      is_premium = false,
      is_active = true,
      is_featured = false,
      is_best_seller = false,
      is_new_arrival = false,
      printing_available = false,
      badges_available = false,
      images = [],
      image_url,
      variants = []
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Product name is required." });
    }

    if (!category_id) {
      return res.status(400).json({ success: false, message: "Product category is required." });
    }

    if (base_price === undefined || isNaN(parseFloat(base_price))) {
      return res.status(400).json({ success: false, message: "A valid base price is required." });
    }

    // Determine total stock from variants if variants provided
    let calculatedStock = parseInt(stock_quantity, 10) || 0;
    if (variants && variants.length > 0) {
      calculatedStock = variants.reduce((sum, v) => sum + (parseInt(v.stock_quantity, 10) || 0), 0);
    }

    // Generate unique slug
    let baseSlug = slugify(name);
    let finalSlug = baseSlug || `product-${Date.now()}`;
    const { data: existingSlug } = await supabase.from("products").select("id").eq("slug", finalSlug).maybeSingle();
    if (existingSlug) {
      finalSlug = `${finalSlug}-${Date.now().toString().slice(-4)}`;
    }

    const { data: product, error: insertErr } = await supabase
      .from("products")
      .insert({
        name: name.trim(),
        slug: finalSlug,
        category_id,
        brand: brand ? brand.trim() : null,
        description: description ? description.trim() : null,
        base_price: parseFloat(base_price),
        old_price: old_price ? parseFloat(old_price) : null,
        stock_quantity: calculatedStock,
        is_premium: Boolean(is_premium),
        is_active: Boolean(is_active),
        is_featured: Boolean(is_featured),
        is_best_seller: Boolean(is_best_seller),
        is_new_arrival: Boolean(is_new_arrival),
        printing_available: Boolean(printing_available),
        badges_available: Boolean(badges_available)
      })
      .select("*")
      .single();

    if (insertErr) throw insertErr;

    // Handle multiple product media / images
    let mediaList = [];
    if (Array.isArray(images) && images.length > 0) {
      mediaList = images.filter((img) => img && (typeof img === 'string' ? img.trim() : img.storage_path));
    } else if (image_url && image_url.trim()) {
      mediaList = [{ storage_path: image_url.trim(), is_cover: true, sort_order: 0 }];
    }

    if (mediaList.length > 0) {
      const mediaInserts = mediaList.map((item, idx) => {
        const path = typeof item === 'string' ? item.trim() : item.storage_path;
        const isCover = typeof item === 'object' && item.is_cover !== undefined ? item.is_cover : idx === 0;
        return {
          product_id: product.id,
          media_type: "image",
          storage_path: path,
          alt_text: (typeof item === 'object' && item.alt_text) || product.name,
          color_value: (typeof item === 'object' && item.color_value) || null,
          is_cover: isCover,
          sort_order: (typeof item === 'object' && item.sort_order !== undefined) ? item.sort_order : idx
        };
      });

      // Ensure at least one cover exists
      if (!mediaInserts.some((m) => m.is_cover) && mediaInserts.length > 0) {
        mediaInserts[0].is_cover = true;
      }

      await supabase.from("product_media").insert(mediaInserts);
    }

    // Handle product variants
    if (Array.isArray(variants) && variants.length > 0) {
      const variantInserts = variants.map((v, idx) => ({
        product_id: product.id,
        size_value: v.size_value ? String(v.size_value).trim() : null,
        size_type: v.size_type || null,
        color_value: v.color_value ? String(v.color_value).trim() : (v.color_name ? String(v.color_name).trim() : null),
        sku: v.sku ? String(v.sku).trim() : null,
        price: v.price !== undefined && v.price !== '' ? parseFloat(v.price) : null,
        old_price: v.old_price !== undefined && v.old_price !== '' ? parseFloat(v.old_price) : null,
        stock_quantity: parseInt(v.stock_quantity, 10) || 0,
        is_active: v.is_active !== undefined ? Boolean(v.is_active) : true,
        sort_order: v.sort_order !== undefined ? parseInt(v.sort_order, 10) : idx
      }));

      await supabase.from("product_variants").insert(variantInserts);
    }

    return res.json({
      success: true,
      product,
      message: `Product "${product.name}" created successfully.`
    });
  } catch (err) {
    console.error("Create product error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/admin/products/:id
 */
const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      category_id,
      brand,
      description,
      base_price,
      old_price,
      stock_quantity,
      is_premium,
      is_active,
      is_featured,
      is_best_seller,
      is_new_arrival,
      printing_available,
      badges_available,
      images,
      image_url,
      variants
    } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (category_id !== undefined) updates.category_id = category_id;
    if (brand !== undefined) updates.brand = brand ? brand.trim() : null;
    if (description !== undefined) updates.description = description ? description.trim() : null;
    if (base_price !== undefined) updates.base_price = parseFloat(base_price);
    if (old_price !== undefined) updates.old_price = old_price ? parseFloat(old_price) : null;
    if (is_premium !== undefined) updates.is_premium = Boolean(is_premium);
    if (is_active !== undefined) updates.is_active = Boolean(is_active);
    if (is_featured !== undefined) updates.is_featured = Boolean(is_featured);
    if (is_best_seller !== undefined) updates.is_best_seller = Boolean(is_best_seller);
    if (is_new_arrival !== undefined) updates.is_new_arrival = Boolean(is_new_arrival);
    if (printing_available !== undefined) updates.printing_available = Boolean(printing_available);
    if (badges_available !== undefined) updates.badges_available = Boolean(badges_available);

    // If variants updated, re-calculate total stock from variants
    if (Array.isArray(variants) && variants.length > 0) {
      updates.stock_quantity = variants.reduce((sum, v) => sum + (parseInt(v.stock_quantity, 10) || 0), 0);
    } else if (stock_quantity !== undefined) {
      updates.stock_quantity = parseInt(stock_quantity, 10) || 0;
    }

    const { data: updatedProduct, error } = await supabase
      .from("products")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    // Handle multiple product media / images if provided
    if (Array.isArray(images)) {
      // Clear existing media
      await supabase.from("product_media").delete().eq("product_id", id);

      const mediaInserts = images
        .filter((img) => img && (typeof img === 'string' ? img.trim() : img.storage_path))
        .map((item, idx) => {
          const path = typeof item === 'string' ? item.trim() : item.storage_path;
          const isCover = typeof item === 'object' && item.is_cover !== undefined ? item.is_cover : idx === 0;
          return {
            product_id: id,
            media_type: "image",
            storage_path: path,
            alt_text: (typeof item === 'object' && item.alt_text) || updatedProduct.name,
            color_value: (typeof item === 'object' && item.color_value) || null,
            is_cover: isCover,
            sort_order: (typeof item === 'object' && item.sort_order !== undefined) ? item.sort_order : idx
          };
        });

      if (mediaInserts.length > 0) {
        if (!mediaInserts.some((m) => m.is_cover)) {
          mediaInserts[0].is_cover = true;
        }
        await supabase.from("product_media").insert(mediaInserts);
      }
    } else if (image_url && image_url.trim()) {
      const { data: existingCover } = await supabase
        .from("product_media")
        .select("id")
        .eq("product_id", id)
        .eq("is_cover", true)
        .maybeSingle();

      if (existingCover) {
        await supabase
          .from("product_media")
          .update({ storage_path: image_url.trim() })
          .eq("id", existingCover.id);
      } else {
        await supabase.from("product_media").insert({
          product_id: id,
          media_type: "image",
          storage_path: image_url.trim(),
          is_cover: true,
          sort_order: 0
        });
      }
    }

    // Handle variants if provided
    if (Array.isArray(variants)) {
      await supabase.from("product_variants").delete().eq("product_id", id);

      if (variants.length > 0) {
        const variantInserts = variants.map((v, idx) => ({
          product_id: id,
          size_value: v.size_value ? String(v.size_value).trim() : null,
          size_type: v.size_type || null,
          color_value: v.color_value ? String(v.color_value).trim() : (v.color_name ? String(v.color_name).trim() : null),
          sku: v.sku ? String(v.sku).trim() : null,
          price: v.price !== undefined && v.price !== '' ? parseFloat(v.price) : null,
          old_price: v.old_price !== undefined && v.old_price !== '' ? parseFloat(v.old_price) : null,
          stock_quantity: parseInt(v.stock_quantity, 10) || 0,
          is_active: v.is_active !== undefined ? Boolean(v.is_active) : true,
          sort_order: v.sort_order !== undefined ? parseInt(v.sort_order, 10) : idx
        }));

        await supabase.from("product_variants").insert(variantInserts);
      }
    }

    return res.json({
      success: true,
      product: updatedProduct,
      message: `Product "${updatedProduct.name}" updated successfully.`
    });
  } catch (err) {
    console.error("Update product error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/admin/products/:id
 */
const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
    return res.json({ success: true, message: "Product deleted successfully." });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// =============================================================================
// 6. CATEGORIES MANAGEMENT
// =============================================================================

/**
 * GET /api/admin/categories
 */
const getCategoriesAdmin = async (req, res) => {
  try {
    let selectFields = `
      id,
      name,
      slug,
      is_active,
      sort_order,
      image_path,
      created_at,
      products (id)
    `;

    let { data: categories, error } = await supabase
      .from("categories")
      .select(selectFields)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error && error.message && error.message.includes("image_path")) {
      const fallback = await supabase
        .from("categories")
        .select(`
          id,
          name,
          slug,
          is_active,
          sort_order,
          created_at,
          products (id)
        `)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      categories = (fallback.data || []).map((c) => ({ ...c, image_path: null }));
      error = fallback.error;
    }

    if (error) throw error;

    const formatted = (categories || []).map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      isActive: cat.is_active,
      sortOrder: cat.sort_order,
      imagePath: cat.image_path || null,
      createdAt: cat.created_at,
      productCount: (cat.products || []).length
    }));

    const total = formatted.length;
    const active = formatted.filter((c) => c.isActive).length;

    return res.json({
      success: true,
      categories: formatted,
      stats: { total, active, inactive: total - active }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/admin/categories
 */
const createCategory = async (req, res) => {
  try {
    const { name, sort_order = 0, is_active = true, image_path } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Category name is required." });
    }

    const slug = slugify(name);
    const categoryData = {
      name: name.trim(),
      slug,
      sort_order: parseInt(sort_order, 10) || 0,
      is_active: Boolean(is_active)
    };
    if (image_path !== undefined) {
      categoryData.image_path = image_path ? image_path.trim() : null;
    }

    let { data, error } = await supabase
      .from("categories")
      .insert(categoryData)
      .select("*")
      .single();

    if (error && error.message && error.message.includes("image_path")) {
      delete categoryData.image_path;
      const retry = await supabase
        .from("categories")
        .insert(categoryData)
        .select("*")
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) throw error;
    return res.json({ success: true, category: data, message: `Category "${data.name}" created.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/admin/categories/:id
 */
const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, sort_order, is_active, image_path } = req.body;

    const updates = {};
    if (name !== undefined) {
      updates.name = name.trim();
      updates.slug = slugify(name);
    }
    if (sort_order !== undefined) updates.sort_order = parseInt(sort_order, 10) || 0;
    if (is_active !== undefined) updates.is_active = Boolean(is_active);
    if (image_path !== undefined) updates.image_path = image_path ? image_path.trim() : null;

    let { data, error } = await supabase
      .from("categories")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error && error.message && error.message.includes("image_path")) {
      delete updates.image_path;
      const retry = await supabase
        .from("categories")
        .update(updates)
        .eq("id", id)
        .select("*")
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) throw error;
    return res.json({ success: true, category: data, message: `Category updated.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/admin/categories/:id
 */
const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if products exist in category
    const { count, error: countErr } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id);

    if (count && count > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category: ${count} product(s) are assigned to it. Reassign products first.`
      });
    }

    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) throw error;

    return res.json({ success: true, message: "Category deleted successfully." });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// =============================================================================
// 7. ORDERS MANAGEMENT
// =============================================================================

/**
 * GET /api/admin/orders
 */
const getOrdersAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 15, status, search } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 15));
    const offset = (pageNum - 1) * limitNum;

    // Order stats
    const [totalRes, pendingRes, preparingRes, onDeliveryRes, deliveredRes, cancelledRes] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "preparing"),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "on_delivery"),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "delivered"),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "cancelled")
    ]);

    let query = supabase.from("orders").select("*, order_items(*)", { count: "exact" });

    if (status) query = query.eq("status", status);
    if (search && search.trim()) {
      const term = search.trim();
      query = query.or(`customer_full_name.ilike.%${term}%,customer_phone.ilike.%${term}%,customer_email.ilike.%${term}%`);
    }

    query = query.order("created_at", { ascending: false }).range(offset, offset + limitNum - 1);

    const { data: orders, count: totalCount, error } = await query;
    if (error) throw error;

    const total = totalCount || 0;
    const totalPages = Math.ceil(total / limitNum);

    return res.json({
      success: true,
      orders: orders || [],
      total,
      page: pageNum,
      totalPages,
      stats: {
        total: totalRes.count || 0,
        pending: pendingRes.count || 0,
        preparing: preparingRes.count || 0,
        onDelivery: onDeliveryRes.count || 0,
        delivered: deliveredRes.count || 0,
        cancelled: cancelledRes.count || 0
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /api/admin/orders/:id/status
 */
const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, message } = req.body;

    const validStatuses = ["pending", "accepted", "preparing", "on_delivery", "delivered", "rejected", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status: ${status}` });
    }

    const updates = { status, updated_at: new Date().toISOString() };
    if (status === "delivered") updates.delivered_at = new Date().toISOString();
    if (status === "rejected") updates.rejected_at = new Date().toISOString();
    if (status === "cancelled") updates.cancelled_at = new Date().toISOString();
    if (message) updates.rejection_message = message;

    const { data, error } = await supabase
      .from("orders")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return res.json({ success: true, order: data, message: `Order status updated to ${status}.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// =============================================================================
// 8. USERS MANAGEMENT
// =============================================================================

/**
 * GET /api/admin/users
 */
const getUsersAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 15, role, search } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 15));
    const offset = (pageNum - 1) * limitNum;

    // User counts
    const [totalRes, verifiedRes, unverifiedRes, adminsRes] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("users").select("id", { count: "exact", head: true }).eq("is_verified", true),
      supabase.from("users").select("id", { count: "exact", head: true }).eq("is_verified", false),
      supabase.from("users").select("id", { count: "exact", head: true }).in("role", ["admin", "super_admin"])
    ]);

    let query = supabase
      .from("users")
      .select("id, full_name, email, role, auth_provider, is_verified, created_at, updated_at", { count: "exact" });

    if (role) query = query.eq("role", role);
    if (search && search.trim()) {
      const term = search.trim();
      query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
    }

    query = query.order("created_at", { ascending: false }).range(offset, offset + limitNum - 1);

    const { data: users, count: totalCount, error } = await query;
    if (error) throw error;

    const total = totalCount || 0;
    const totalPages = Math.ceil(total / limitNum);

    return res.json({
      success: true,
      users: users || [],
      total,
      page: pageNum,
      totalPages,
      stats: {
        total: totalRes.count || 0,
        verified: verifiedRes.count || 0,
        unverified: unverifiedRes.count || 0,
        admins: adminsRes.count || 0
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /api/admin/users/:id/role
 */
const updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!["user", "admin"].includes(role)) {
      return res.status(400).json({ success: false, message: "Valid roles to assign: 'user', 'admin'." });
    }

    // Safeguard: Current user cannot change own role
    if (req.user.id === id) {
      return res.status(400).json({ success: false, message: "Cannot modify your own administrator role." });
    }

    const { data, error } = await supabase
      .from("users")
      .update({ role, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, full_name, email, role")
      .single();

    if (error) throw error;
    return res.json({ success: true, user: data, message: `User role updated to ${role}.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// =============================================================================
// 9. REVIEWS MANAGEMENT
// =============================================================================

/**
 * GET /api/admin/reviews
 */
const getReviewsAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 15 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 15));
    const offset = (pageNum - 1) * limitNum;

    const [totalRes, visibleRes, ratingAvgRes] = await Promise.all([
      supabase.from("product_reviews").select("id", { count: "exact", head: true }),
      supabase.from("product_reviews").select("id", { count: "exact", head: true }).eq("is_visible", true),
      supabase.from("product_reviews").select("rating")
    ]);

    const allRatings = (ratingAvgRes.data || []).map((r) => parseFloat(r.rating) || 0);
    const avgRating = allRatings.length > 0 ? (allRatings.reduce((a, b) => a + b, 0) / allRatings.length).toFixed(1) : 0;

    const { data: reviews, count: totalCount, error } = await supabase
      .from("product_reviews")
      .select(`
        id,
        user_id,
        product_id,
        product_name_snapshot,
        rating,
        review_text,
        is_visible,
        created_at,
        users (id, full_name, email)
      `, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) throw error;

    const total = totalCount || 0;
    const totalPages = Math.ceil(total / limitNum);

    return res.json({
      success: true,
      reviews: reviews || [],
      total,
      page: pageNum,
      totalPages,
      stats: {
        total: totalRes.count || 0,
        visible: visibleRes.count || 0,
        hidden: (totalRes.count || 0) - (visibleRes.count || 0),
        averageRating: parseFloat(avgRating)
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /api/admin/reviews/:id/visibility
 */
const toggleReviewVisibility = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_visible } = req.body;

    const { data, error } = await supabase
      .from("product_reviews")
      .update({ is_visible: Boolean(is_visible) })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return res.json({ success: true, review: data, message: `Review visibility set to ${is_visible}.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/admin/reviews/:id
 */
const deleteReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from("product_reviews").delete().eq("id", id);
    if (error) throw error;
    return res.json({ success: true, message: "Review deleted successfully." });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// =============================================================================
// 10. NOTIFICATIONS MANAGEMENT
// =============================================================================

/**
 * GET /api/admin/notifications
 */
const getNotificationsAdmin = async (req, res) => {
  try {
    const [totalRes, unreadRes] = await Promise.all([
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_type", "admin"),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_type", "admin").eq("is_read", false)
    ]);

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("recipient_type", "admin")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    return res.json({
      success: true,
      notifications: data || [],
      stats: {
        total: totalRes.count || 0,
        unread: unreadRes.count || 0,
        read: (totalRes.count || 0) - (unreadRes.count || 0)
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /api/admin/notifications/:id/read
 */
const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;
    return res.json({ success: true, message: "Notification marked as read." });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/admin/notifications/mark-all-read
 */
const markAllNotificationsRead = async (req, res) => {
  try {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("recipient_type", "admin")
      .eq("is_read", false);

    if (error) throw error;
    return res.json({ success: true, message: "All notifications marked as read." });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getDashboardOverview,
  uploadMedia,
  // Home
  getHomeOverview,
  getHeroSlidesAdmin,
  createHeroSlide,
  updateHeroSlide,
  deleteHeroSlide,
  getOfferBarsAdmin,
  createOfferBar,
  updateOfferBar,
  deleteOfferBar,
  // Settings
  getSiteSettingsAdmin,
  updateSiteSettingsAdmin,
  // Products
  getProductsOverview,
  getProductsAdmin,
  getProductByIdAdmin,
  createProduct,
  updateProduct,
  deleteProduct,
  // Categories
  getCategoriesAdmin,
  createCategory,
  updateCategory,
  deleteCategory,
  // Orders
  getOrdersAdmin,
  updateOrderStatus,
  // Users
  getUsersAdmin,
  updateUserRole,
  // Reviews
  getReviewsAdmin,
  toggleReviewVisibility,
  deleteReview,
  // Notifications
  getNotificationsAdmin,
  markNotificationRead,
  markAllNotificationsRead
};
