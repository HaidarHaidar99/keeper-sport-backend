const supabase = require("../config/supabase");

/**
 * Get Public Site Settings
 * GET /api/site-settings
 */
const getSiteSettings = async (req, res) => {
  try {
    const { data: settings, error } = await supabase
      .from("site_settings")
      .select("site_name, logo_path, favicon_path, phone_number, email, whatsapp_number, instagram_url, facebook_url, tiktok_url, x_url, location_name, location_url, about_us, delivery_fee, printing_price, badge_price, premier_league_badge_available, champions_league_badge_available, la_liga_badge_available")
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

const { getCategoryImagesMap } = require("../utils/categoryStorage");

/**
 * Get Active Categories
 * GET /api/categories
 */
const getCategories = async (req, res) => {
  try {
    let { data: categories, error } = await supabase
      .from("categories")
      .select("id, name, slug, sort_order, is_active, image_path")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error && error.message && error.message.includes("image_path")) {
      const fallback = await supabase
        .from("categories")
        .select("id, name, slug, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      categories = (fallback.data || []).map((c) => ({ ...c, image_path: null }));
      error = fallback.error;
    }

    if (error) {
      console.error("Error fetching categories:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch categories."
      });
    }

    // Merge images from persistent storage map
    const imageMap = await getCategoryImagesMap().catch(() => ({}));
    const formattedCategories = (categories || []).map((c) => ({
      ...c,
      image_path: c.image_path || imageMap[c.id] || null
    }));

    return res.json({
      success: true,
      categories: formattedCategories
    });
  } catch (err) {
    console.error("Unexpected error in getCategories:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching categories."
    });
  }
};

const crypto = require("crypto");

/**
 * Get User Dynamic Counts for Navbar (Cart, Favorites, Orders, Notifications)
 * GET /api/user/counts
 */
const getUserCounts = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const guestIdentifier = req.headers["x-guest-identifier"] || req.cookies?.keeper_guest_cart || null;
    const rawTokensHeader = req.headers["x-guest-order-tokens"] || null;

    if (!userId && !guestIdentifier) {
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

    if (userId) {
      // Authenticated User counts
      const [favRes, ordersRes, cartRes, notifRes] = await Promise.all([
        supabase
          .from("favorites")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),

        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),

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
    }

    // Guest counts
    let guestTokens = [];
    if (rawTokensHeader) {
      try {
        const parsed = typeof rawTokensHeader === "string" ? JSON.parse(rawTokensHeader) : rawTokensHeader;
        if (Array.isArray(parsed)) {
          guestTokens = parsed.filter((t) => typeof t === "string" && t.length > 0);
        }
      } catch {
        // May be a comma separated list
        guestTokens = String(rawTokensHeader).split(",").map((t) => t.trim()).filter(Boolean);
      }
    }

    const tokenHashes = guestTokens.map((t) =>
      crypto.createHash("sha256").update(t).digest("hex")
    );

    const [favRes, ordersRes, cartRes] = await Promise.all([
      supabase
        .from("favorites")
        .select("id", { count: "exact", head: true })
        .eq("guest_identifier", guestIdentifier),

      (async () => {
        if (tokenHashes.length === 0) return 0;
        const { count } = await supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .in("guest_access_token_hash", tokenHashes);
        return count || 0;
      })(),

      (async () => {
        const { data: cart } = await supabase
          .from("carts")
          .select("id")
          .eq("guest_identifier", guestIdentifier)
          .maybeSingle();

        if (!cart) return 0;

        const { data: items } = await supabase
          .from("cart_items")
          .select("quantity")
          .eq("cart_id", cart.id);

        if (!items || items.length === 0) return 0;
        return items.reduce((sum, i) => sum + (i.quantity || 1), 0);
      })()
    ]);

    return res.json({
      success: true,
      counts: {
        favorites: favRes.count || 0,
        orders: typeof ordersRes === "number" ? ordersRes : 0,
        cart: typeof cartRes === "number" ? cartRes : 0,
        notifications: 0
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

/**
 * Get Public Active Offers
 * GET /api/offers
 */
const getOffers = async (req, res) => {
  try {
    const now = new Date().toISOString();
    const { data: offers, error } = await supabase
      .from("offers")
      .select("id, title, description, discount_type, discount_value, free_delivery, starts_at, ends_at, is_visible")
      .eq("is_visible", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching offers:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch offers."
      });
    }

    const activeOffers = (offers || []).filter((offer) => {
      if (offer.starts_at && new Date(offer.starts_at) > new Date(now)) return false;
      if (offer.ends_at && new Date(offer.ends_at) < new Date(now)) return false;
      return true;
    });

    return res.json({
      success: true,
      offers: activeOffers
    });
  } catch (err) {
    console.error("Unexpected error in getOffers:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching offers."
    });
  }
};

/**
 * Get Public Visible Product Reviews
 * GET /api/reviews
 */
const getPublicReviews = async (req, res) => {
  try {
    const { data: reviews, error } = await supabase
      .from("product_reviews")
      .select("id, product_id, product_name_snapshot, rating, review_text, created_at, users:user_id(full_name)")
      .eq("is_visible", true)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error fetching public reviews:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch reviews."
      });
    }

    const formatted = (reviews || []).map((r) => ({
      id: r.id,
      product_id: r.product_id,
      product_name: r.product_name_snapshot,
      rating: Number(r.rating) || 5,
      review_text: r.review_text,
      created_at: r.created_at,
      author: r.users?.full_name || "Verified Customer"
    }));

    return res.json({
      success: true,
      reviews: formatted
    });
  } catch (err) {
    console.error("Unexpected error in getPublicReviews:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching public reviews."
    });
  }
};

/**
 * Submit Contact Us Message
 * POST /api/contact
 */
const submitContactMessage = async (req, res) => {
  try {
    const { full_name, email, phone, message } = req.body || {};

    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ success: false, message: "Full name is required." });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, message: "Phone number is required." });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Message is required." });
    }

    const userId = req.user?.id || null;

    // Insert into real contact_messages table
    const { data: contactRecord, error: contactError } = await supabase
      .from("contact_messages")
      .insert({
        user_id: userId,
        full_name: full_name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        message: message.trim()
      })
      .select("id")
      .single();

    if (contactError) {
      console.error("Error creating contact message:", contactError);
      return res.status(500).json({
        success: false,
        message: "Could not submit message. Please try again."
      });
    }

    // Insert into real admin notifications
    try {
      await supabase.from("notifications").insert({
        recipient_type: "admin",
        type: "contact",
        title: `Inquiry from ${full_name.trim()}`,
        message: message.trim().slice(0, 180),
        reference_type: "contact_message",
        reference_id: contactRecord.id,
        is_read: false
      });
    } catch (notifErr) {
      console.warn("Notification insert warning:", notifErr);
    }

    return res.json({
      success: true,
      message: "Thank you for contacting Keeper Sports. We have received your inquiry."
    });
  } catch (err) {
    console.error("Unexpected error in submitContactMessage:", err);
    return res.status(500).json({
      success: false,
      message: "Server error submitting contact message."
    });
  }
};

/**
 * Get Customer Notifications
 * GET /api/notifications
 */
const getCustomerNotifications = async (req, res) => {
  try {
    const userId = req.user?.id || null;

    if (!userId) {
      return res.json({
        success: true,
        notifications: [],
        isGuest: true
      });
    }

    const { data: notifications, error } = await supabase
      .from("notifications")
      .select("id, type, title, message, reference_type, reference_id, is_read, read_at, created_at")
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error fetching customer notifications:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch notifications." });
    }

    return res.json({
      success: true,
      notifications: notifications || [],
      isGuest: false
    });
  } catch (err) {
    console.error("Unexpected error in getCustomerNotifications:", err);
    return res.status(500).json({ success: false, message: "Server error fetching notifications." });
  }
};

/**
 * Mark Customer Notification as Read
 * PATCH /api/notifications/:id/read
 */
const markCustomerNotificationRead = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("recipient_user_id", userId);

    if (error) {
      console.error("Error marking notification read:", error);
      return res.status(500).json({ success: false, message: "Failed to mark notification read." });
    }

    return res.json({ success: true, message: "Notification marked as read." });
  } catch (err) {
    console.error("Unexpected error in markCustomerNotificationRead:", err);
    return res.status(500).json({ success: false, message: "Server error marking notification read." });
  }
};

/**
 * Mark All Customer Notifications as Read
 * POST /api/notifications/mark-all-read
 */
const markAllCustomerNotificationsRead = async (req, res) => {
  try {
    const userId = req.user?.id || null;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("recipient_user_id", userId)
      .eq("is_read", false);

    if (error) {
      console.error("Error marking all notifications read:", error);
      return res.status(500).json({ success: false, message: "Failed to mark notifications read." });
    }

    return res.json({ success: true, message: "All notifications marked as read." });
  } catch (err) {
    console.error("Unexpected error in markAllCustomerNotificationsRead:", err);
    return res.status(500).json({ success: false, message: "Server error marking notifications read." });
  }
};

module.exports = {
  getSiteSettings,
  getHeroSlides,
  getOfferBars,
  getCategories,
  getUserCounts,
  getOffers,
  getPublicReviews,
  submitContactMessage,
  getCustomerNotifications,
  markCustomerNotificationRead,
  markAllCustomerNotificationsRead
};

