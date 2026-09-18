const supabase = require("../config/supabase");
const { generateRandomToken, hashToken } = require("../utils/tokenUtils");

// ── Authoritative Order Creation Engine ───────────────────────────────────────
const createOrder = async ({
    customerId = null,
    delivery,
    items,
    paymentMethod = "COD"
}) => {
    if (!items || !Array.isArray(items) || items.length === 0) {
        const err = new Error("Order must contain at least one item");
        err.statusCode = 400;
        throw err;
    }

    if (!delivery || !delivery.phone || !delivery.city || !delivery.address) {
        const err = new Error("Complete delivery information (phone, city, address) is required");
        err.statusCode = 400;
        throw err;
    }

    // Step 1: Validate items and re-check authoritative prices and stock from the database
    let totalAmount = 0;
    const validatedItems = [];

    for (const item of items) {
        const { product_id, variant_id, quantity, customization } = item;
        const qty = parseInt(quantity, 10);
        if (isNaN(qty) || qty <= 0) {
            const err = new Error("Invalid quantity specified");
            err.statusCode = 400;
            throw err;
        }

        // Fetch authoritative product details
        const { data: product, error: prodErr } = await supabase
            .from("products")
            .select("id, name_en, name_ar, base_price, is_sale_enabled, sale_price, is_active")
            .eq("id", product_id)
            .single();

        if (prodErr || !product || !product.is_active) {
            const err = new Error(`Product is unavailable or does not exist (ID: ${product_id})`);
            err.statusCode = 400;
            throw err;
        }

        // Fetch authoritative variant details
        let variant = null;
        if (variant_id) {
            const { data: vData, error: varErr } = await supabase
                .from("product_variants")
                .select("id, size, price, track_quantity, physical_stock, reserved_stock, is_available")
                .eq("id", variant_id)
                .single();

            if (varErr || !vData) {
                const err = new Error(`Selected size/variant is invalid (Variant ID: ${variant_id})`);
                err.statusCode = 400;
                throw err;
            }

            // Check availability if quantity tracking is enabled
            if (vData.track_quantity && (vData.physical_stock - vData.reserved_stock) < qty) {
                const err = new Error(`Insufficient stock for product "${product.name_en}" (Size: ${vData.size || "Standard"}). Available: ${vData.physical_stock - vData.reserved_stock}`);
                err.statusCode = 400;
                throw err;
            }
            variant = vData;
        }

        // Calculate authoritative unit price:
        // Priority: Product sale price (if enabled) > Variant specific price > Product base price
        let authoritativeUnitPrice;
        if (product.is_sale_enabled && product.sale_price !== null && product.sale_price >= 0) {
            authoritativeUnitPrice = parseFloat(product.sale_price);
        } else if (variant && variant.price !== null && variant.price >= 0) {
            authoritativeUnitPrice = parseFloat(variant.price);
        } else {
            authoritativeUnitPrice = parseFloat(product.base_price);
        }

        // Account for customization pricing if applicable (e.g. kit name/number/badges)
        let customizationPrice = 0;
        if (customization) {
            if (customization.name || customization.number) {
                customizationPrice += parseFloat(customization.name_number_price || 0);
            }
            if (Array.isArray(customization.badges)) {
                for (const badge of customization.badges) {
                    customizationPrice += parseFloat(badge.price || 0);
                }
            }
        }

        const finalUnitPrice = authoritativeUnitPrice + customizationPrice;
        const lineTotal      = finalUnitPrice * qty;
        totalAmount         += lineTotal;

        validatedItems.push({
            product_id:           product.id,
            variant_id:           variant ? variant.id : null,
            product_name_snapshot: product.name_en,
            size_snapshot:         variant ? variant.size : null,
            quantity:              qty,
            unit_price:            finalUnitPrice,
            total_price:           lineTotal,
            customization_details: customization || null,
            track_quantity:        variant ? variant.track_quantity : false
        });
    }

    // Step 2: Handle guest authentication vs logged-in customer
    let rawGuestToken  = null;
    let guestTokenHash = null;

    if (!customerId) {
        rawGuestToken  = generateRandomToken(32);
        guestTokenHash = hashToken(rawGuestToken);
    }

    // Step 3: Insert Order record with delivery snapshot
    const orderPayload = {
        customer_id:           customerId,
        guest_token_hash:      guestTokenHash,
        delivery_phone:        delivery.phone,
        delivery_country:      delivery.country || "Lebanon",
        delivery_city:         delivery.city,
        delivery_address:      delivery.address,
        delivery_live_location: delivery.live_location || null,
        total_amount:          totalAmount,
        payment_method:        paymentMethod,
        payment_status:        "Unpaid",
        order_status:          "Pending"
    };

    const { data: order, error: orderErr } = await supabase
        .from("orders")
        .insert([orderPayload])
        .select()
        .single();

    if (orderErr) {
        const err = new Error("Failed to create order");
        err.details = orderErr.message;
        throw err;
    }

    // Step 4: Insert Order Items & invoke atomic stock reservation
    const orderItemsPayload = validatedItems.map(item => ({
        order_id:              order.id,
        product_id:            item.product_id,
        variant_id:            item.variant_id,
        product_name_snapshot: item.product_name_snapshot,
        size_snapshot:         item.size_snapshot,
        quantity:              item.quantity,
        unit_price:            item.unit_price,
        total_price:           item.total_price,
        customization_details: item.customization_details
    }));

    const { error: itemsErr } = await supabase
        .from("order_items")
        .insert(orderItemsPayload);

    if (itemsErr) {
        console.error("Failed to insert order items:", itemsErr);
    }

    // Reserve stock via atomic PostgreSQL function for tracked variants
    for (const item of validatedItems) {
        if (item.variant_id && item.track_quantity) {
            try {
                await supabase.rpc("reserve_variant_stock", {
                    p_variant_id: item.variant_id,
                    p_quantity:   item.quantity,
                    p_order_id:   order.id
                });
            } catch (rpcErr) {
                console.error(`Warning: Could not reserve stock for variant ${item.variant_id}:`, rpcErr);
            }
        }
    }

    return {
        order,
        items:           validatedItems,
        raw_guest_token: rawGuestToken // Provided only once to guest client for local storage
    };
};

// ── Retrieve Guest Orders via SHA-256 Hashed Token ────────────────────────────
const getGuestOrders = async (rawGuestToken) => {
    if (!rawGuestToken) {
        const err = new Error("Guest access token is required");
        err.statusCode = 400;
        throw err;
    }

    const hashed = hashToken(rawGuestToken);

    const { data: orders, error } = await supabase
        .from("orders")
        .select(`
            id,
            order_number,
            delivery_phone,
            delivery_city,
            delivery_address,
            total_amount,
            payment_method,
            payment_status,
            order_status,
            rejection_reason,
            admin_notes,
            created_at,
            order_items (
                id,
                product_id,
                variant_id,
                product_name_snapshot,
                size_snapshot,
                quantity,
                unit_price,
                total_price,
                customization_details
            )
        `)
        .eq("guest_token_hash", hashed)
        .order("created_at", { ascending: false });

    if (error) {
        const err = new Error("Failed to fetch guest orders");
        err.details = error.message;
        throw err;
    }

    return orders || [];
};

// ── Retrieve Customer Orders ──────────────────────────────────────────────────
const getCustomerOrders = async (customerId) => {
    const { data: orders, error } = await supabase
        .from("orders")
        .select(`
            id,
            order_number,
            delivery_phone,
            delivery_city,
            delivery_address,
            total_amount,
            payment_method,
            payment_status,
            order_status,
            rejection_reason,
            admin_notes,
            created_at,
            order_items (
                id,
                product_id,
                variant_id,
                product_name_snapshot,
                size_snapshot,
                quantity,
                unit_price,
                total_price,
                customization_details
            )
        `)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });

    if (error) {
        const err = new Error("Failed to fetch orders");
        err.details = error.message;
        throw err;
    }

    return orders || [];
};

// ── Get Single Order Details ──────────────────────────────────────────────────
const getOrderById = async (orderId, authContext = {}) => {
    const { data: order, error } = await supabase
        .from("orders")
        .select(`
            id,
            order_number,
            customer_id,
            guest_token_hash,
            delivery_phone,
            delivery_country,
            delivery_city,
            delivery_address,
            delivery_live_location,
            total_amount,
            payment_method,
            payment_status,
            order_status,
            rejection_reason,
            admin_notes,
            created_at,
            updated_at,
            order_items (
                id,
                product_id,
                variant_id,
                product_name_snapshot,
                size_snapshot,
                quantity,
                unit_price,
                total_price,
                customization_details
            )
        `)
        .eq("id", orderId)
        .single();

    if (error || !order) {
        const err = new Error("Order not found");
        err.statusCode = 404;
        throw err;
    }

    // Authorization verification
    if (authContext.isAdmin) return order;
    if (authContext.customerId && order.customer_id === authContext.customerId) return order;
    if (authContext.rawGuestToken && order.guest_token_hash === hashToken(authContext.rawGuestToken)) return order;

    const err = new Error("Access denied: You are not authorized to view this order");
    err.statusCode = 403;
    throw err;
};

// ── Update Order Status (Admin) with Stock Transitions ────────────────────────
const updateOrderStatus = async (orderId, { order_status, payment_status, rejection_reason, admin_notes }) => {
    // 1. Fetch current order state and items
    //    product_id is now included so we can call increment_product_total_sold
    const { data: currentOrder, error: fetchErr } = await supabase
        .from("orders")
        .select(`
            id,
            order_status,
            payment_status,
            order_items (
                id,
                product_id,
                variant_id,
                quantity
            )
        `)
        .eq("id", orderId)
        .single();

    if (fetchErr || !currentOrder) {
        const err = new Error("Order not found");
        err.statusCode = 404;
        throw err;
    }

    // Check mandatory rejection reason (Section 21)
    if (["Declined", "Cancelled"].includes(order_status) && (!rejection_reason || rejection_reason.trim() === "")) {
        const err = new Error("A rejection/cancellation reason is mandatory when declining or cancelling an order");
        err.statusCode = 400;
        throw err;
    }

    const updates = { updated_at: new Date().toISOString() };
    if (order_status       !== undefined) updates.order_status     = order_status;
    if (payment_status     !== undefined) updates.payment_status   = payment_status;
    if (rejection_reason   !== undefined) updates.rejection_reason = rejection_reason;
    if (admin_notes        !== undefined) updates.admin_notes      = admin_notes;

    // 2. Perform stock transitions if status changed
    const items = currentOrder.order_items || [];

    // Declined/Cancelled → release reserved stock
    if (
        ["Declined", "Cancelled"].includes(order_status) &&
        !["Declined", "Cancelled", "Delivered"].includes(currentOrder.order_status)
    ) {
        for (const item of items) {
            if (item.variant_id) {
                try {
                    await supabase.rpc("release_variant_stock", {
                        p_variant_id: item.variant_id,
                        p_quantity:   item.quantity,
                        p_order_id:   orderId,
                        p_reason:     rejection_reason || "Order cancelled by admin"
                    });
                } catch (e) {
                    console.error(`Failed to release stock for variant ${item.variant_id}:`, e);
                }
            }
        }
    }

    // Delivered → fulfill stock AND increment total_sold (idempotent)
    if (order_status === "Delivered" && currentOrder.order_status !== "Delivered") {
        for (const item of items) {
            // Step A: fulfill inventory (deducts physical + reserved stock)
            if (item.variant_id) {
                try {
                    await supabase.rpc("fulfill_order_variant_stock", {
                        p_variant_id: item.variant_id,
                        p_quantity:   item.quantity,
                        p_order_id:   orderId
                    });
                } catch (e) {
                    console.error(`Failed to fulfill stock for variant ${item.variant_id}:`, e);
                }
            }

            // Step B: increment product total_sold counter (idempotent via product_sold_increments PK).
            // Passes only the order_item_id — the DB function derives product_id and quantity
            // from order_items internally, enforcing the DB invariant.
            // No-op on retry (ON CONFLICT DO NOTHING on the PK).
            if (item.id) {
                try {
                    await supabase.rpc("increment_product_total_sold", {
                        p_order_item_id: item.id
                    });
                } catch (e) {
                    console.error(`Failed to increment total_sold for order item ${item.id}:`, e);
                }
            }
        }
    }

    // 3. Save order updates
    const { data: updatedOrder, error: updateErr } = await supabase
        .from("orders")
        .update(updates)
        .eq("id", orderId)
        .select()
        .single();

    if (updateErr) {
        const err = new Error("Failed to update order status");
        err.details = updateErr.message;
        throw err;
    }

    return updatedOrder;
};

module.exports = {
    createOrder,
    getGuestOrders,
    getCustomerOrders,
    getOrderById,
    updateOrderStatus
};
