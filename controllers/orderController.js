const supabase = require("../config/supabase");
const crypto = require("crypto");

/**
 * Get Customer Orders (Authenticated User or Guest via Tokens)
 * GET /api/orders
 */
const getUserOrders = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const rawTokensHeader = req.headers["x-guest-order-tokens"] || req.query.guestTokens || null;

    if (userId) {
      const { data: orders, error } = await supabase
        .from("orders")
        .select("*, order_items(*)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching user orders:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch orders." });
      }

      return res.json({
        success: true,
        orders: orders || []
      });
    }

    // Guest Orders Flow (Cryptographically isolated via guest_access_token_hash)
    let guestTokens = [];
    if (rawTokensHeader) {
      try {
        const parsed = typeof rawTokensHeader === "string" ? JSON.parse(rawTokensHeader) : rawTokensHeader;
        if (Array.isArray(parsed)) {
          guestTokens = parsed.filter((t) => typeof t === "string" && t.length > 0);
        }
      } catch {
        guestTokens = String(rawTokensHeader).split(",").map((t) => t.trim()).filter(Boolean);
      }
    }

    if (guestTokens.length === 0) {
      return res.json({
        success: true,
        orders: []
      });
    }

    const tokenHashes = guestTokens.map((t) =>
      crypto.createHash("sha256").update(t).digest("hex")
    );

    const { data: guestOrders, error: guestErr } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .in("guest_access_token_hash", tokenHashes)
      .order("created_at", { ascending: false });

    if (guestErr) {
      console.error("Error fetching guest orders:", guestErr);
      return res.status(500).json({ success: false, message: "Failed to fetch orders." });
    }

    return res.json({
      success: true,
      orders: guestOrders || []
    });
  } catch (err) {
    console.error("Unexpected error in getUserOrders:", err);
    return res.status(500).json({ success: false, message: "Server error fetching orders." });
  }
};

/**
 * Create New Order (Storefront Checkout / Direct Order)
 * POST /api/orders
 */
const createOrder = async (req, res) => {
  try {
    const {
      customer_full_name,
      customer_phone,
      customer_email,
      area,
      address,
      location_url,
      payment_method = "cash_on_delivery",
      items = []
    } = req.body || {};

    if (!customer_full_name || !customer_full_name.trim()) {
      return res.status(400).json({ success: false, message: "Full name is required." });
    }
    if (!customer_phone || !customer_phone.trim()) {
      return res.status(400).json({ success: false, message: "Phone number is required." });
    }
    if (!area || !area.trim()) {
      return res.status(400).json({ success: false, message: "Area / City is required." });
    }
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: "Your order contains no items." });
    }

    // Fetch site settings for delivery fee snapshot
    const { data: settings } = await supabase
      .from("site_settings")
      .select("delivery_fee, printing_price, badge_price")
      .eq("id", 1)
      .maybeSingle();

    const deliveryFee = Number(settings?.delivery_fee || 0);
    const printingFee = Number(settings?.printing_price || 0);
    const badgeFee = Number(settings?.badge_price || 0);

    let subtotal = 0;
    const preparedItems = [];

    // Verify each item against real products and compute totals
    for (const item of items) {
      const pId = item.productId || item.product_id;
      if (!pId) continue;

      const { data: product } = await supabase
        .from("products")
        .select("id, name, base_price, old_price, stock_quantity, category:categories(name)")
        .eq("id", pId)
        .maybeSingle();

      if (!product) continue;

      // Get cover image
      const { data: media } = await supabase
        .from("product_media")
        .select("storage_path")
        .eq("product_id", product.id)
        .order("is_cover", { ascending: false })
        .limit(1)
        .maybeSingle();

      const unitPrice = Number(product.base_price || 0);
      const qty = Math.max(1, parseInt(item.quantity, 10) || 1);

      let extraPrice = 0;
      if (item.printedName || item.printedNumber) {
        extraPrice += printingFee;
      }
      if (item.badge) {
        extraPrice += badgeFee;
      }

      const lineTotal = (unitPrice + extraPrice) * qty;
      subtotal += lineTotal;

      preparedItems.push({
        product_id: product.id,
        variant_id: item.variantId || null,
        product_name_snapshot: product.name,
        category_name_snapshot: product.category?.name || "General",
        cover_image_path_snapshot: media?.storage_path || null,
        size_value_snapshot: item.size || item.size_value || null,
        color_value_snapshot: item.color || item.color_value || null,
        quantity: qty,
        original_unit_price: unitPrice,
        unit_discount_amount: 0,
        final_unit_price: unitPrice,
        printed_name: item.printedName || null,
        printed_number: item.printedNumber || null,
        badge: item.badge || null,
        printing_price_snapshot: extraPrice > 0 ? printingFee : 0,
        badge_price_snapshot: item.badge ? badgeFee : 0,
        line_total: lineTotal
      });
    }

    if (preparedItems.length === 0) {
      return res.status(400).json({ success: false, message: "Valid products required to place order." });
    }

    const total = subtotal + deliveryFee;
    const userId = req.user?.id || null;

    let guestTokenHash = null;
    let rawToken = null;
    if (!userId) {
      rawToken = crypto.randomBytes(24).toString("hex");
      guestTokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    }

    // Insert into real orders table
    const { data: newOrder, error: orderError } = await supabase
      .from("orders")
      .insert({
        user_id: userId,
        guest_access_token_hash: guestTokenHash,
        customer_full_name: customer_full_name.trim(),
        customer_phone: customer_phone.trim(),
        customer_email: customer_email ? customer_email.trim().toLowerCase() : null,
        area: area.trim(),
        address: address ? address.trim() : null,
        location_url: location_url ? location_url.trim() : null,
        payment_method: payment_method === "whish_money" ? "whish_money" : "cash_on_delivery",
        payment_status: "unpaid",
        status: "pending",
        subtotal: subtotal,
        discount_amount: 0,
        delivery_fee: deliveryFee,
        total: total
      })
      .select("*")
      .single();

    if (orderError) {
      console.error("Error creating order:", orderError);
      return res.status(500).json({ success: false, message: "Failed to place order. Please try again." });
    }

    // Insert items into real order_items table
    const orderItemsWithId = preparedItems.map((item) => ({
      ...item,
      order_id: newOrder.id
    }));

    await supabase.from("order_items").insert(orderItemsWithId);

    // Initial status history entry
    await supabase.from("order_status_history").insert({
      order_id: newOrder.id,
      from_status: null,
      to_status: "pending",
      changed_by: userId,
      message: "Order placed by customer."
    });

    // Clear cart for this customer/guest if this was a cart order
    try {
      const guestIdentifier = req.headers["x-guest-identifier"] || req.cookies?.keeper_guest_cart || null;
      let cartIdToClear = null;
      if (userId) {
        const { data: uCart } = await supabase.from("carts").select("id").eq("user_id", userId).maybeSingle();
        if (uCart) cartIdToClear = uCart.id;
      } else if (guestIdentifier) {
        const { data: gCart } = await supabase.from("carts").select("id").eq("guest_identifier", guestIdentifier).maybeSingle();
        if (gCart) cartIdToClear = gCart.id;
      }
      if (cartIdToClear) {
        await supabase.from("cart_items").delete().eq("cart_id", cartIdToClear);
      }
    } catch (clearErr) {
      console.warn("Notice: could not clear cart after order:", clearErr);
    }

    // Notify admins
    try {
      await supabase.from("notifications").insert({
        recipient_type: "admin",
        type: "order",
        title: `New Order #${newOrder.order_number}`,
        message: `${customer_full_name.trim()} placed an order for $${total.toFixed(2)} (${preparedItems.length} items).`,
        reference_type: "order",
        reference_id: newOrder.id,
        is_read: false
      });
    } catch (notifErr) {
      console.warn("Notification insert warning:", notifErr);
    }

    return res.status(201).json({
      success: true,
      message: "Order placed successfully!",
      order: {
        id: newOrder.id,
        order_number: newOrder.order_number,
        subtotal: newOrder.subtotal,
        delivery_fee: newOrder.delivery_fee,
        total: newOrder.total,
        status: newOrder.status,
        guestAccessToken: rawToken || null
      },
      guestAccessToken: rawToken || null
    });
  } catch (err) {
    console.error("Unexpected error in createOrder:", err);
    return res.status(500).json({ success: false, message: "Server error creating order." });
  }
};

/**
 * Get Single Order Details
 * GET /api/orders/:id
 */
const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: order, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", id)
      .maybeSingle();

    if (error || !order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    // If authenticated, ensure user owns order or is admin
    if (req.user && order.user_id && req.user.role !== "admin" && req.user.role !== "super_admin") {
      if (order.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: "Access forbidden." });
      }
    }

    return res.json({
      success: true,
      order
    });
  } catch (err) {
    console.error("Unexpected error in getOrderById:", err);
    return res.status(500).json({ success: false, message: "Server error fetching order." });
  }
};

module.exports = {
  getUserOrders,
  createOrder,
  getOrderById
};
