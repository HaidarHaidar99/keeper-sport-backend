const crypto = require("crypto");
const supabase = require("../config/supabase");

/**
 * Toggle Favorite for User or Guest
 * POST /api/favorites/toggle
 * Body: { productId, guestIdentifier }
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

    // Check if product actually exists
    const { data: product, error: prodErr } = await supabase
      .from("products")
      .select("id, name")
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

    if (existingFav) {
      // Remove favorite
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
      // Add favorite
      const insertData = {
        product_id: productId,
        user_id: userId,
        guest_identifier: userId ? null : guestIdentifier
      };

      const { error: insertErr } = await supabase
        .from("favorites")
        .insert(insertData);

      if (insertErr) {
        console.error("Error adding favorite:", insertErr);
        return res.status(500).json({
          success: false,
          message: "Failed to add to favorites."
        });
      }
      isFavorited = true;
    }

    // Get updated favorites count
    let countQuery = supabase
      .from("favorites")
      .select("id", { count: "exact", head: true });

    if (userId) {
      countQuery = countQuery.eq("user_id", userId);
    } else {
      countQuery = countQuery.eq("guest_identifier", guestIdentifier);
    }

    const { count: favoritesCount } = await countQuery;

    return res.json({
      success: true,
      isFavorited,
      favoritesCount: favoritesCount || 0,
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
 * Get User's or Guest's Favorited Product IDs
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
        ids: []
      });
    }

    let query = supabase.from("favorites").select("product_id");
    if (userId) {
      query = query.eq("user_id", userId);
    } else {
      query = query.eq("guest_identifier", guestIdentifier);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching favorite IDs:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch favorite items."
      });
    }

    const ids = (data || []).map((f) => f.product_id);

    return res.json({
      success: true,
      favoriteIds: ids,
      ids: ids,
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
    if (userId) {
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
  clearFavorites
};

