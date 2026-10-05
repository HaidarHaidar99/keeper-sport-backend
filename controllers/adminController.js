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
    // Fetch low stock threshold from settings
    const { data: settings } = await supabase
      .from("site_settings")
      .select("low_stock_threshold")
      .eq("id", 1)
      .maybeSingle();

    const lowStockThreshold = settings?.low_stock_threshold || 5;

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

    if (!media_path) {
      return res.status(400).json({ success: false, message: "Media path/URL is required." });
    }

    const { data, error } = await supabase
      .from("hero_slides")
      .insert({
        title: title || null,
        subtitle: subtitle || null,
        media_type,
        media_path,
        fallback_image_path: fallback_image_path || null,
        primary_button_text: primary_button_text || null,
        primary_button_route: primary_button_route || null,
        secondary_button_text: secondary_button_text || null,
        secondary_button_route: secondary_button_route || null,
        duration_seconds: parseInt(duration_seconds, 10) || 5,
        sort_order: parseInt(sort_order, 10) || 0,
        is_active: Boolean(is_active)
      })
      .select("*")
      .single();

    if (error) throw error;
    return res.json({ success: true, slide: data, message: "Hero slide created successfully." });
  } catch (err) {
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
    if (title !== undefined) updates.title = title;
    if (subtitle !== undefined) updates.subtitle = subtitle;
    if (media_type !== undefined) updates.media_type = media_type;
    if (media_path !== undefined) updates.media_path = media_path;
    if (fallback_image_path !== undefined) updates.fallback_image_path = fallback_image_path;
    if (primary_button_text !== undefined) updates.primary_button_text = primary_button_text;
    if (primary_button_route !== undefined) updates.primary_button_route = primary_button_route;
    if (secondary_button_text !== undefined) updates.secondary_button_text = secondary_button_text;
    if (secondary_button_route !== undefined) updates.secondary_button_route = secondary_button_route;
    if (duration_seconds !== undefined) updates.duration_seconds = parseInt(duration_seconds, 10) || 5;
    if (sort_order !== undefined) updates.sort_order = parseInt(sort_order, 10) || 0;
    if (is_active !== undefined) updates.is_active = Boolean(is_active);

    const { data, error } = await supabase
      .from("hero_slides")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return res.json({ success: true, slide: data, message: "Hero slide updated successfully." });
  } catch (err) {
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
    if (error) throw error;
    return res.json({ success: true, message: "Hero slide deleted successfully." });
  } catch (err) {
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

    const { data, error } = await supabase
      .from("offer_bars")
      .insert({
        text: text.trim(),
        route: route || null,
        duration_seconds: parseInt(duration_seconds, 10) || 4,
        sort_order: parseInt(sort_order, 10) || 0,
        is_active: Boolean(is_active),
        starts_at: starts_at || null,
        ends_at: ends_at || null
      })
      .select("*")
      .single();

    if (error) throw error;
    return res.json({ success: true, offer: data, message: "Offer bar created successfully." });
  } catch (err) {
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
    if (route !== undefined) updates.route = route;
    if (duration_seconds !== undefined) updates.duration_seconds = parseInt(duration_seconds, 10) || 4;
    if (sort_order !== undefined) updates.sort_order = parseInt(sort_order, 10) || 0;
    if (is_active !== undefined) updates.is_active = Boolean(is_active);
    if (starts_at !== undefined) updates.starts_at = starts_at || null;
    if (ends_at !== undefined) updates.ends_at = ends_at || null;

    const { data, error } = await supabase
      .from("offer_bars")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return res.json({ success: true, offer: data, message: "Offer bar updated successfully." });
  } catch (err) {
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
    const updates = { ...req.body };
    delete updates.id;
    delete updates.created_at;

    const { data, error } = await supabase
      .from("site_settings")
      .update(updates)
      .eq("id", 1)
      .select("*")
      .single();

    if (error) throw error;
    return res.json({ success: true, settings: data, message: "Site settings updated successfully." });
  } catch (err) {
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
    const { data: settings } = await supabase
      .from("site_settings")
      .select("low_stock_threshold")
      .eq("id", 1)
      .maybeSingle();

    const lowStockThreshold = settings?.low_stock_threshold || 5;

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

    // Fetch site low stock threshold
    const { data: settings } = await supabase.from("site_settings").select("low_stock_threshold").eq("id", 1).maybeSingle();
    const lowStockThreshold = settings?.low_stock_threshold || 5;

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
      image_url
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
        stock_quantity: parseInt(stock_quantity, 10) || 0,
        is_premium: Boolean(is_premium),
        is_active: Boolean(is_active),
        is_featured: Boolean(is_featured),
        is_best_seller: Boolean(is_best_seller),
        is_new_arrival: Boolean(is_new_arrival)
      })
      .select("*")
      .single();

    if (insertErr) throw insertErr;

    // If image_url provided, link it in product_media
    if (image_url && image_url.trim()) {
      await supabase.from("product_media").insert({
        product_id: product.id,
        media_type: "image",
        storage_path: image_url.trim(),
        is_cover: true,
        sort_order: 0
      });
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
      image_url
    } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (category_id !== undefined) updates.category_id = category_id;
    if (brand !== undefined) updates.brand = brand ? brand.trim() : null;
    if (description !== undefined) updates.description = description ? description.trim() : null;
    if (base_price !== undefined) updates.base_price = parseFloat(base_price);
    if (old_price !== undefined) updates.old_price = old_price ? parseFloat(old_price) : null;
    if (stock_quantity !== undefined) updates.stock_quantity = parseInt(stock_quantity, 10) || 0;
    if (is_premium !== undefined) updates.is_premium = Boolean(is_premium);
    if (is_active !== undefined) updates.is_active = Boolean(is_active);
    if (is_featured !== undefined) updates.is_featured = Boolean(is_featured);
    if (is_best_seller !== undefined) updates.is_best_seller = Boolean(is_best_seller);
    if (is_new_arrival !== undefined) updates.is_new_arrival = Boolean(is_new_arrival);

    const { data: updatedProduct, error } = await supabase
      .from("products")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    // If image_url updated
    if (image_url && image_url.trim()) {
      // Upsert cover image
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

    return res.json({
      success: true,
      product: updatedProduct,
      message: `Product "${updatedProduct.name}" updated successfully.`
    });
  } catch (err) {
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
    const { data: categories, error } = await supabase
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

    if (error) throw error;

    const formatted = (categories || []).map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      isActive: cat.is_active,
      sortOrder: cat.sort_order,
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
    const { name, sort_order = 0, is_active = true } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Category name is required." });
    }

    const slug = slugify(name);

    const { data, error } = await supabase
      .from("categories")
      .insert({
        name: name.trim(),
        slug,
        sort_order: parseInt(sort_order, 10) || 0,
        is_active: Boolean(is_active)
      })
      .select("*")
      .single();

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
    const { name, sort_order, is_active } = req.body;

    const updates = {};
    if (name !== undefined) {
      updates.name = name.trim();
      updates.slug = slugify(name);
    }
    if (sort_order !== undefined) updates.sort_order = parseInt(sort_order, 10) || 0;
    if (is_active !== undefined) updates.is_active = Boolean(is_active);

    const { data, error } = await supabase
      .from("categories")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

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

    let query = supabase.from("orders").select("*", { count: "exact" });

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
