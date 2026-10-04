const supabase = require("../config/supabase");

/**
 * Get Public Site Settings
 * GET /api/site-settings
 */
const getSiteSettings = async (req, res) => {
  try {
    const { data: settings, error } = await supabase
      .from("site_settings")
      .select("site_name, logo_path, favicon_path, phone_number, email, whatsapp_number, instagram_url, facebook_url, tiktok_url, x_url, location_name, location_url, about_us")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      console.error("Error fetching site settings:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch site settings."
      });
    }

    return res.json({
      success: true,
      settings: settings || {
        site_name: "Keeper Sports",
        logo_path: null
      }
    });
  } catch (err) {
    console.error("Unexpected error in getSiteSettings:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching site settings."
    });
  }
};

/**
 * Get Active Hero Slides
 * GET /api/hero-slides
 */
const getHeroSlides = async (req, res) => {
  try {
    const { data: slides, error } = await supabase
      .from("hero_slides")
      .select("id, title, subtitle, media_type, media_path, fallback_image_path, primary_button_text, primary_button_route, secondary_button_text, secondary_button_route, duration_seconds, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching hero slides:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch hero slides."
      });
    }

    return res.json({
      success: true,
      slides: slides || []
    });
  } catch (err) {
    console.error("Unexpected error in getHeroSlides:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching hero slides."
    });
  }
};

/**
 * Get Active Offer Bars
 * GET /api/offer-bars
 */
const getOfferBars = async (req, res) => {
  try {
    const now = new Date().toISOString();

    const { data: offers, error } = await supabase
      .from("offer_bars")
      .select("id, text, route, duration_seconds, sort_order, starts_at, ends_at, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching offer bars:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch offer bars."
      });
    }

    // Filter active time window in memory or via query
    const validOffers = (offers || []).filter((offer) => {
      if (offer.starts_at && new Date(offer.starts_at) > new Date(now)) return false;
      if (offer.ends_at && new Date(offer.ends_at) < new Date(now)) return false;
      return true;
    });

    return res.json({
      success: true,
      offers: validOffers
    });
  } catch (err) {
    console.error("Unexpected error in getOfferBars:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching offer bars."
    });
  }
};

/**
 * Get Active Categories
 * GET /api/categories
 */
const getCategories = async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from("categories")
      .select("id, name, slug, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("Error fetching categories:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch categories."
      });
    }

    return res.json({
      success: true,
      categories: categories || []
    });
  } catch (err) {
    console.error("Unexpected error in getCategories:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching categories."
    });
  }
};

/**
 * Get User Dynamic Counts for Navbar (Cart, Favorites, Orders, Notifications)
 * GET /api/user/counts
 */
const getUserCounts = async (req, res) => {
  try {
    if (!req.user) {
      return res.json({
        success: true,
        counts: {
          favorites: 0,
          orders: 0,
          cart: 0,
          notifications: 0
        }
      });
    }

    const userId = req.user.id;

    // Run count queries in parallel
    const [favRes, ordersRes, cartRes, notifRes] = await Promise.all([
      // Favorites count
      supabase
        .from("favorites")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),

      // Orders count
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),

      // Cart items count
      (async () => {
        const { data: cart } = await supabase
          .from("carts")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();

        if (!cart) return 0;

        const { data: items } = await supabase
          .from("cart_items")
          .select("quantity")
          .eq("cart_id", cart.id);

        if (!items || items.length === 0) return 0;
        return items.reduce((sum, i) => sum + (i.quantity || 1), 0);
      })(),

      // Unread notifications count
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_user_id", userId)
        .eq("is_read", false)
    ]);

    return res.json({
      success: true,
      counts: {
        favorites: favRes.count || 0,
        orders: ordersRes.count || 0,
        cart: typeof cartRes === "number" ? cartRes : 0,
        notifications: notifRes.count || 0
      }
    });
  } catch (err) {
    console.error("Unexpected error in getUserCounts:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching user counts."
    });
  }
};

module.exports = {
  getSiteSettings,
  getHeroSlides,
  getOfferBars,
  getCategories,
  getUserCounts
};
