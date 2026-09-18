const supabase = require("../config/supabase");

// Submit Exchange Request (Customer or Guest with order verification)
const requestExchange = async ({ orderId, orderItemId, customerId = null, replacementVariantId, reason }) => {
    if (!reason || reason.trim() === "") {
        const err = new Error("Reason for exchange is mandatory");
        err.statusCode = 400;
        throw err;
    }

    // 1. Verify order item belongs to order
    const { data: item, error: itemErr } = await supabase
        .from("order_items")
        .select("id, order_id, variant_id, product_name_snapshot, size_snapshot")
        .eq("id", orderItemId)
        .eq("order_id", orderId)
        .single();

    if (itemErr || !item) {
        const err = new Error("Specified item not found in this order");
        err.statusCode = 404;
        throw err;
    }

    // 2. Verify target replacement variant is available
    const { data: replacement, error: repErr } = await supabase
        .from("product_variants")
        .select("id, size, physical_stock, reserved_stock, is_available")
        .eq("id", replacementVariantId)
        .single();

    if (repErr || !replacement || !replacement.is_available) {
        const err = new Error("The requested replacement size is currently out of stock");
        err.statusCode = 400;
        throw err;
    }

    // 3. Create exchange record
    const { data: exchange, error: exErr } = await supabase
        .from("order_exchanges")
        .insert([{
            order_id: orderId,
            order_item_id: orderItemId,
            customer_id: customerId,
            original_variant_id: item.variant_id,
            replacement_variant_id: replacementVariantId,
            reason: reason.trim(),
            status: "pending"
        }])
        .select()
        .single();

    if (exErr) {
        const err = new Error("Failed to submit exchange request");
        err.details = exErr.message;
        throw err;
    }

    return exchange;
};

// Get Exchanges for Customer or Admin
const getExchanges = async ({ customerId = null, status = null } = {}) => {
    let query = supabase
        .from("order_exchanges")
        .select(`
            id,
            order_id,
            order_item_id,
            customer_id,
            reason,
            status,
            decline_reason,
            admin_notes,
            created_at,
            updated_at,
            orders (
                order_number,
                delivery_phone,
                delivery_city
            ),
            original:product_variants!order_exchanges_original_variant_id_fkey (
                id,
                size
            ),
            replacement:product_variants!order_exchanges_replacement_variant_id_fkey (
                id,
                size
            )
        `)
        .order("created_at", { ascending: false });

    if (customerId) {
        query = query.eq("customer_id", customerId);
    }
    if (status) {
        query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
        const err = new Error("Failed to fetch exchanges");
        err.details = error.message;
        throw err;
    }

    return data || [];
};

// Admin Update Exchange Status with Stock Transitions
const updateExchangeStatus = async (exchangeId, { status, decline_reason, admin_notes }) => {
    const { data: exchange, error: fetchErr } = await supabase
        .from("order_exchanges")
        .select("id, original_variant_id, replacement_variant_id, status")
        .eq("id", exchangeId)
        .single();

    if (fetchErr || !exchange) {
        const err = new Error("Exchange record not found");
        err.statusCode = 404;
        throw err;
    }

    if (status === "declined" && (!decline_reason || decline_reason.trim() === "")) {
        const err = new Error("A decline reason is mandatory when rejecting an exchange");
        err.statusCode = 400;
        throw err;
    }

    // Handle stock transitions upon completion
    if (status === "completed" && exchange.status !== "completed") {
        // Return original item back to shelf: physical_stock + 1
        if (exchange.original_variant_id) {
            const { data: orig } = await supabase
                .from("product_variants")
                .select("physical_stock")
                .eq("id", exchange.original_variant_id)
                .single();

            if (orig) {
                await supabase
                    .from("product_variants")
                    .update({ physical_stock: orig.physical_stock + 1 })
                    .eq("id", exchange.original_variant_id);
            }
        }

        // Deduct replacement item dispatched to customer: physical_stock - 1
        if (exchange.replacement_variant_id) {
            const { data: rep } = await supabase
                .from("product_variants")
                .select("physical_stock")
                .eq("id", exchange.replacement_variant_id)
                .single();

            if (rep) {
                await supabase
                    .from("product_variants")
                    .update({ physical_stock: Math.max(0, rep.physical_stock - 1) })
                    .eq("id", exchange.replacement_variant_id);
            }
        }
    }

    const updates = {
        status,
        updated_at: new Date().toISOString()
    };
    if (decline_reason !== undefined) updates.decline_reason = decline_reason;
    if (admin_notes !== undefined) updates.admin_notes = admin_notes;

    const { data: updated, error: updateErr } = await supabase
        .from("order_exchanges")
        .update(updates)
        .eq("id", exchangeId)
        .select()
        .single();

    if (updateErr) {
        const err = new Error("Failed to update exchange status");
        err.details = updateErr.message;
        throw err;
    }

    return updated;
};

module.exports = {
    requestExchange,
    getExchanges,
    updateExchangeStatus
};
