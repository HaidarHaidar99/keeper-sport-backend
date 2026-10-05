const supabase = require("../config/supabase");

/**
 * Toggle Favorite for Authenticated User
 * POST /api/favorites/toggle
 * Body: { productId }
 */
const toggleFavorite = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Please sign in to save products to your favorites."
      });
    }

    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required."
      });
    }

    const userId = req.user.id;

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
    const { data: existingFav, error: findErr } = await supabase
      .from("favorites")
      .select("id")
      .eq("user_id", userId)
      .eq("product_id", productId)
      .maybeSingle();

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
      const { error: insertErr } = await supabase
        .from("favorites")
        .insert({
          user_id: userId,
          product_id: productId
        });

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
    const { count: favoritesCount } = await supabase
      .from("favorites")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    return res.json({
      success: true,
      isFavorited,
      favoritesCount: favoritesCount || 0,
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
 * Get User's Favorited Product IDs
 * GET /api/favorites/ids
 */
const getUserFavoriteIds = async (req, res) => {
  try {
    if (!req.user) {
      return res.json({
        success: true,
        favoriteIds: []
      });
    }

    const { data, error } = await supabase
      .from("favorites")
      .select("product_id")
      .eq("user_id", req.user.id);

    if (error) {
      console.error("Error fetching user favorite IDs:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch favorite items."
      });
    }

    return res.json({
      success: true,
      favoriteIds: (data || []).map((f) => f.product_id)
    });
  } catch (err) {
    console.error("Error in getUserFavoriteIds:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching favorites."
    });
  }
};

module.exports = {
  toggleFavorite,
  getUserFavoriteIds
};
