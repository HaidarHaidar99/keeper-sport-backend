const crypto = require("crypto");
const supabase = require("../config/supabase");

/**
 * Compute effective pricing for a product (matches productController.js)
 */
const computeProductPricing = (product, activeOffersMap = new Map()) => {
  const basePrice = parseFloat(product.base_price) || 0;
  const oldPrice = product.old_price ? parseFloat(product.old_price) : null;

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

/**
 * Helper: Fetch deduplicated active favorite product IDs for a user or guest
 */
const getActiveFavoriteProductIds = async (userId, guestIdentifier) => {
  if (!userId && !guestIdentifier) return [];

  let query = supabase
    .from("favorites")
    .select("product_id, products!inner(id, is_active)")
    .eq("products.is_active", true)
    .order("created_at", { ascending: false });

  if (userId) {
    query = query.eq("user_id", userId);
  } else {
    query = query.eq("guest_identifier", guestIdentifier);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return Array.from(new Set((data || []).map((f) => f.product_id).filter(Boolean)));
};

/**
 * Toggle or Explicitly Set Favorite for User or Guest
 * POST /api/favorites/toggle
 * Body: { productId, action?: "add" | "remove", desiredState?: boolean, guestIdentifier? }
 */
const toggleFavorite = async (req, res) => {
  try {
    const productId = req.body?.productId || req.body?.product_id;
    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required."
      });
    }

    const userId = req.user?.id || null;
    let guestIdentifier = req.headers["x-guest-identifier"] || req.cookies?.keeper_guest_cart || req.body?.guestIdentifier || null;

    if (!userId && !guestIdentifier) {
      guestIdentifier = `guest_${crypto.randomUUID()}`;
    }

    // Optional explicit action to make add/remove idempotent and prevent desyncs
    const rawAction = typeof req.body?.action === "string" ? req.body.action.toLowerCase() : null;
    let targetState = null;
    if (rawAction === "add" || req.body?.desiredState === true) {
      targetState = true;
    } else if (rawAction === "remove" || req.body?.desiredState === false) {
      targetState = false;
    }

    // Explicit remove: delete any matching favorite row even if product was deactivated/deleted
    if (targetState === false) {
      let delQuery = supabase
        .from("favorites")
        .delete()
        .eq("product_id", productId);

      if (userId) {
        delQuery = delQuery.eq("user_id", userId);
      } else {
        delQuery = delQuery.eq("guest_identifier", guestIdentifier);
      }

      const { error: delErr } = await delQuery;
      if (delErr) {
        console.error("Error removing favorite:", delErr);
        return res.status(500).json({
          success: false,
          message: "Failed to remove from favorites."
        });
      }

      const activeIds = await getActiveFavoriteProductIds(userId, guestIdentifier);
      return res.json({
        success: true,
        isFavorited: false,
        favoriteIds: activeIds,
        ids: activeIds,
        favoritesCount: activeIds.length,
        guestIdentifier: userId ? null : guestIdentifier,
        message: "Removed from favorites."
      });
    }

    // Check if product actually exists
    const { data: product, error: prodErr } = await supabase
      .from("products")
      .select("id, name, is_active")
      .eq("id", productId)
      .maybeSingle();

    if (prodErr || !product) {
      return res.status(404).json({
        success: false,
        message: "Product not found."
      });
    }

    // Check if already favorited
    let findQuery = supabase
      .from("favorites")
      .select("id")
      .eq("product_id", productId);

    if (userId) {
      findQuery = findQuery.eq("user_id", userId);
    } else {
      findQuery = findQuery.eq("guest_identifier", guestIdentifier);
    }

    const { data: existingFav, error: findErr } = await findQuery.maybeSingle();

    if (findErr) {
      console.error("Error checking favorite:", findErr);
      return res.status(500).json({
        success: false,
        message: "Failed to check favorite status."
      });
    }

    let isFavorited = false;

    if (targetState === true) {
      // Explicit add (idempotent)
      if (!existingFav) {
        const insertData = {
          product_id: productId,
          user_id: userId,
          guest_identifier: userId ? null : guestIdentifier
        };

        const { error: insertErr } = await supabase
          .from("favorites")
          .insert(insertData);

        if (insertErr && insertErr.code !== "23505") {
          console.error("Error adding favorite:", insertErr);
          return res.status(500).json({
            success: false,
            message: "Failed to add to favorites."
          });
        }
      }
      isFavorited = true;
    } else if (existingFav) {
      // Legacy toggle: remove
      const { error: delErr } = await supabase
        .from("favorites")
        .delete()
        .eq("id", existingFav.id);

      if (delErr) {
        console.error("Error removing favorite:", delErr);
        return res.status(500).json({
          success: false,
          message: "Failed to remove from favorites."
        });
      }
      isFavorited = false;
    } else {
      // Legacy toggle: add
      const insertData = {
        product_id: productId,
        user_id: userId,
        guest_identifier: userId ? null : guestIdentifier
      };

      const { error: insertErr } = await supabase
        .from("favorites")
        .insert(insertData);

      if (insertErr && insertErr.code !== "23505") {
        console.error("Error adding favorite:", insertErr);
        return res.status(500).json({
          success: false,
          message: "Failed to add to favorites."
        });
      }
      isFavorited = true;
    }

    const activeIds = await getActiveFavoriteProductIds(userId, guestIdentifier);

    return res.json({
      success: true,
      isFavorited,
      favoriteIds: activeIds,
      ids: activeIds,
      favoritesCount: activeIds.length,
      guestIdentifier: userId ? null : guestIdentifier,
      message: isFavorited ? "Added to favorites." : "Removed from favorites."
    });
  } catch (err) {
    console.error("Error in toggleFavorite:", err);
    return res.status(500).json({
      success: false,
      message: "Server error processing favorite."
    });
  }
};

/**
 * Get User's or Guest's Favorited Active Product IDs
 * GET /api/favorites/ids
 */
const getUserFavoriteIds = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const guestIdentifier = req.headers["x-guest-identifier"] || req.cookies?.keeper_guest_cart || null;

    if (!userId && !guestIdentifier) {
      return res.json({
        success: true,
        favoriteIds: [],
        ids: [],
        favoritesCount: 0
      });
    }

    const ids = await getActiveFavoriteProductIds(userId, guestIdentifier);

    return res.json({
      success: true,
      favoriteIds: ids,
      ids,
      favoritesCount: ids.length,
      guestIdentifier: userId ? null : guestIdentifier
    });
  } catch (err) {
    console.error("Error in getUserFavoriteIds:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching favorites."
    });
  }
};

/**
 * Get User's or Guest's Full Favorited Active Products
 * GET /api/favorites
 */
const getFavoriteProducts = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const guestIdentifier = req.headers["x-guest-identifier"] || req.cookies?.keeper_guest_cart || null;

    if (!userId && !guestIdentifier) {
      return res.json({
        success: true,
        products: [],
        favoriteIds: [],
        ids: [],
        favoritesCount: 0
      });
    }

    const activeIds = await getActiveFavoriteProductIds(userId, guestIdentifier);
    if (activeIds.length === 0) {
      return res.json({
        success: true,
        products: [],
        favoriteIds: [],
        ids: [],
        favoritesCount: 0
      });
    }

    const now = new Date().toISOString();

    const [productsRes, categoriesRes, mediaRes, ratingsRes, offerProdsRes] = await Promise.all([
      supabase
        .from("products")
        .select(
          "id, category_id, name, slug, brand, description, base_price, old_price, stock_quantity, is_premium, is_active, is_featured, is_best_seller, is_new_arrival, printing_available, badges_available, created_at"
        )
        .in("id", activeIds)
        .eq("is_active", true),

      supabase.from("categories").select("id, name, slug").eq("is_active", true),

      supabase
        .from("product_media")
        .select("id, product_id, media_type, storage_path, alt_text, is_cover, sort_order")
        .in("product_id", activeIds)
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true }),

      supabase
        .from("product_rating_summary")
        .select("product_id, average_rating, ratings_count")
        .in("product_id", activeIds),

      supabase
        .from("offer_products")
        .select("offer_id, product_id, offers(id, title, discount_type, discount_value, starts_at, ends_at, is_visible)")
        .in("product_id", activeIds)
    ]);

    if (productsRes.error) {
      throw productsRes.error;
    }

    const categoriesMap = new Map((categoriesRes.data || []).map((c) => [c.id, c]));
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

    const productsById = new Map((productsRes.data || []).map((p) => [String(p.id), p]));

    const formatted = activeIds
      .map((id) => productsById.get(String(id)))
      .filter(Boolean)
      .map((p) => {
        const media = mediaMap.get(p.id) || [];
        const primaryMedia = media.find((m) => m.is_cover) || media[0] || null;
        const ratingInfo = ratingsMap.get(p.id) || null;
        const pricing = computeProductPricing(p, activeOffersMap);
        const categoryObj = categoriesMap.get(p.category_id) || null;

        const stockQty = p.stock_quantity || 0;
        const stockStatus = stockQty <= 0 ? "out_of_stock" : "in_stock";

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
            isLowStock: false,
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
          isFavorited: true,
          printingAvailable: Boolean(p.printing_available),
          badgesAvailable: Boolean(p.badges_available),
          createdAt: p.created_at
        };
      });

    const validIds = formatted.map((p) => p.id);

    return res.json({
      success: true,
      products: formatted,
      favoriteIds: validIds,
      ids: validIds,
      favoritesCount: formatted.length
    });
  } catch (err) {
    console.error("Error in getFavoriteProducts:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching favorite products."
    });
  }
};

/**
 * Clear All Favorites for User or Guest
 * DELETE /api/favorites
 */
const clearFavorites = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const guestIdentifier = req.headers["x-guest-identifier"] || req.cookies?.keeper_guest_cart || null;

    if (!userId && !guestIdentifier) {
      return res.status(400).json({ success: false, message: "User or guest identifier required." });
    }

    let delQuery = supabase.from("favorites").delete();
    if (userId && guestIdentifier) {
      delQuery = delQuery.or(`user_id.eq.${userId},guest_identifier.eq.${guestIdentifier}`);
    } else if (userId) {
      delQuery = delQuery.eq("user_id", userId);
    } else {
      delQuery = delQuery.eq("guest_identifier", guestIdentifier);
    }

    const { error } = await delQuery;

    if (error) {
      console.error("Error clearing favorites:", error);
      return res.status(500).json({ success: false, message: "Failed to clear favorites." });
    }

    return res.json({
      success: true,
      message: "Favorites cleared successfully.",
      favoriteIds: [],
      ids: [],
      favoritesCount: 0
    });
  } catch (err) {
    console.error("Error in clearFavorites:", err);
    return res.status(500).json({ success: false, message: "Server error clearing favorites." });
  }
};

module.exports = {
  toggleFavorite,
  getUserFavoriteIds,
  getFavoriteProducts,
  clearFavorites
};
