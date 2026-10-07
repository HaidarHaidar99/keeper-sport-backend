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

    // Verify each item against real products and compute totals with strict stock revalidation
    for (const item of items) {
      const pId = item.productId || item.product_id;
      if (!pId) continue;

      const { data: product } = await supabase
        .from("products")
        .select("id, name, base_price, old_price, stock_quantity, category:categories(name)")
        .eq("id", pId)
        .maybeSingle();

      if (!product) continue;

      const qty = Math.max(1, parseInt(item.quantity, 10) || 1);

      // Resolve variant if applicable
      let variant = null;
      const vId = item.variantId || item.selectedVariantId || item.selected_variant_id;
      if (vId) {
        const { data: vData } = await supabase
          .from("product_variants")
          .select("*")
          .eq("id", vId)
          .maybeSingle();
        variant = vData;
      } else if (item.size || item.color) {
        let vQuery = supabase
          .from("product_variants")
          .select("*")
          .eq("product_id", product.id)
          .eq("is_active", true);
        if (item.size) vQuery = vQuery.eq("size_value", item.size);
        if (item.color) vQuery = vQuery.eq("color_value", item.color);
        const { data: vList } = await vQuery.limit(1);
        variant = vList?.[0] || null;
      }

      // STRICT CHECKOUT-TIME STOCK REVALIDATION
      if (variant) {
        const variantDesc = [
          variant.size_value ? `Size ${variant.size_value}` : null,
          variant.color_value ? `Color ${variant.color_value}` : null
        ].filter(Boolean).join(" / ");
        const variantSuffix = variantDesc ? ` — ${variantDesc}` : "";

        if (variant.stock_quantity <= 0) {
          return res.status(400).json({
            success: false,
            message: `"${product.name}${variantSuffix}" is currently out of stock.`
          });
        }
        if (qty > variant.stock_quantity) {
          return res.status(400).json({
            success: false,
            message: `Only ${variant.stock_quantity} units of ${product.name}${variantSuffix} are currently available.`
          });
        }
      } else {
        if (product.stock_quantity <= 0) {
          return res.status(400).json({
            success: false,
            message: `"${product.name}" is currently out of stock.`
          });
        }
        if (qty > product.stock_quantity) {
          return res.status(400).json({
            success: false,
            message: `Only ${product.stock_quantity} units of ${product.name} are currently available.`
          });
        }
      }

      // Get cover image
      const { data: media } = await supabase
        .from("product_media")
        .select("storage_path")
        .eq("product_id", product.id)
        .order("is_cover", { ascending: false })
        .limit(1)
        .maybeSingle();

      const unitPrice = variant?.price ? Number(variant.price) : Number(product.base_price || 0);

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
        variant_id: variant?.id || vId || null,
        product_name_snapshot: product.name,
        category_name_snapshot: product.category?.name || "General",
        cover_image_path_snapshot: media?.storage_path || null,
        size_value_snapshot: item.size || item.size_value || variant?.size_value || null,
        color_value_snapshot: item.color || item.color_value || variant?.color_value || null,
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

    // Safely decrement inventory for purchased items
    try {
      for (const it of preparedItems) {
        if (it.variant_id) {
          const { data: curVar } = await supabase
            .from("product_variants")
            .select("stock_quantity")
            .eq("id", it.variant_id)
            .maybeSingle();
          if (curVar) {
            const newVarQty = Math.max(0, curVar.stock_quantity - it.quantity);
            await supabase.from("product_variants").update({ stock_quantity: newVarQty }).eq("id", it.variant_id);
          }
        }
        const { data: curProd } = await supabase
          .from("products")
          .select("stock_quantity")
          .eq("id", it.product_id)
          .maybeSingle();
        if (curProd) {
          const newProdQty = Math.max(0, curProd.stock_quantity - it.quantity);
          await supabase.from("products").update({ stock_quantity: newProdQty }).eq("id", it.product_id);
        }
      }
    } catch (stockDecErr) {
      console.warn("Stock decrement warning:", stockDecErr);
    }

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

/**
 * Customer Cancel Order
 * PATCH /api/orders/:id/cancel
 * Strictly permitted ONLY while status === 'pending'
 */
const cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || null;
    const rawTokensHeader = req.headers["x-guest-order-tokens"] || req.headers["x-guest-access-token"] || null;

    if (!id) {
      return res.status(400).json({ success: false, message: "Order ID is required." });
    }

    const { data: order, error: findErr } = await supabase
      .from("orders")
      .select("id, status, user_id, guest_access_token_hash, order_number")
      .eq("id", id)
      .maybeSingle();

    if (findErr || !order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    // 1. Ownership verification
    let isAuthorized = false;
    if (userId && order.user_id && order.user_id === userId) {
      isAuthorized = true;
    } else if (order.guest_access_token_hash && rawTokensHeader) {
      let candidateTokens = [];
      try {
        const parsed = typeof rawTokensHeader === "string" ? JSON.parse(rawTokensHeader) : rawTokensHeader;
        if (Array.isArray(parsed)) {
          candidateTokens = parsed;
        } else {
          candidateTokens = [rawTokensHeader];
        }
      } catch {
        candidateTokens = String(rawTokensHeader).split(",").map((t) => t.trim());
      }

      for (const t of candidateTokens) {
        if (!t || typeof t !== "string") continue;
        const hash = crypto.createHash("sha256").update(t).digest("hex");
        if (hash === order.guest_access_token_hash) {
          isAuthorized = true;
          break;
        }
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ success: false, message: "Unauthorized to cancel this order." });
    }

    // 2. Strict status check: ONLY PENDING may be cancelled by customer
    if (order.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Order #${order.order_number} cannot be cancelled because it is already ${order.status}. Cancellation is only permitted while order is pending.`
      });
    }

    // 3. Update status to 'cancelled'
    const { data: updatedOrder, error: updateErr } = await supabase
      .from("orders")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select("*, order_items(*)")
      .single();

    if (updateErr) {
      console.error("Error cancelling order:", updateErr);
      return res.status(500).json({ success: false, message: "Failed to cancel order." });
    }

    // 4. Record in status history
    try {
      await supabase.from("order_status_history").insert({
        order_id: id,
        from_status: "pending",
        to_status: "cancelled",
        changed_by: userId,
        message: "Order cancelled by customer."
      });
    } catch (hErr) {
      console.warn("Status history warning:", hErr);
    }

    return res.json({
      success: true,
      message: `Order #${order.order_number} has been cancelled.`,
      order: updatedOrder
    });
  } catch (err) {
    console.error("Unexpected error in cancelOrder:", err);
    return res.status(500).json({ success: false, message: "Server error cancelling order." });
  }
};

module.exports = {
  getUserOrders,
  createOrder,
  getOrderById,
  cancelOrder
};

