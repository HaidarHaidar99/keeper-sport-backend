const supabase = require("../config/supabase");

// Record Direct Walk-In Physical Store Sale (Atomic Stored Procedure)
const recordStoreSale = async ({ variantId, quantity, adminId, notes = "Physical store POS sale" }) => {
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
        const err = new Error("Valid positive quantity is required");
        err.statusCode = 400;
        throw err;
    }

    const { error } = await supabase.rpc("record_physical_store_sale", {
        p_variant_id: variantId,
        p_quantity: qty,
        p_admin_id: adminId,
        p_notes: notes
    });

    if (error) {
        const err = new Error("Failed to record store sale: " + error.message);
        err.statusCode = 400;
        throw err;
    }

    // Return updated variant stock state
    const { data: variant } = await supabase
        .from("product_variants")
        .select("id, size, physical_stock, reserved_stock, available_stock, is_available")
        .eq("id", variantId)
        .single();

    return {
        success: true,
        variant
    };
};

// Adjust / Restock Inventory with Audit Trail
const adjustStock = async ({ variantId, physicalChange, reason = "RESTOCK", adminId, notes }) => {
    const change = parseInt(physicalChange, 10);
    if (isNaN(change)) {
        const err = new Error("Valid numeric stock change is required");
        err.statusCode = 400;
        throw err;
    }

    // 1. Fetch current stock state with row lock concept
    const { data: current, error: fetchErr } = await supabase
        .from("product_variants")
        .select("id, physical_stock, reserved_stock")
        .eq("id", variantId)
        .single();

    if (fetchErr || !current) {
        const err = new Error("Product variant not found");
        err.statusCode = 404;
        throw err;
    }

    const newPhysical = current.physical_stock + change;
    if (newPhysical < 0) {
        const err = new Error("Adjustment would result in negative physical stock");
        err.statusCode = 400;
        throw err;
    }

    // 2. Update variant physical stock
    const { data: updatedVariant, error: updateErr } = await supabase
        .from("product_variants")
        .update({
            physical_stock: newPhysical,
            updated_at: new Date().toISOString()
        })
        .eq("id", variantId)
        .select("id, size, physical_stock, reserved_stock, available_stock, is_available")
        .single();

    if (updateErr) {
        const err = new Error("Failed to update stock");
        err.details = updateErr.message;
        throw err;
    }

    // 3. Write audit log entry
    await supabase.from("inventory_audit_logs").insert([{
        variant_id: variantId,
        change_type: reason || "RESTOCK",
        quantity_change: change,
        previous_physical: current.physical_stock,
        new_physical: newPhysical,
        previous_reserved: current.reserved_stock,
        new_reserved: current.reserved_stock,
        reference_id: adminId,
        notes: notes || "Manual stock adjustment by admin"
    }]);

    return updatedVariant;
};

// Retrieve Inventory Audit Trail
const getAuditLogs = async ({ variantId = null, limit = 50, offset = 0 } = {}) => {
    let query = supabase
        .from("inventory_audit_logs")
        .select(`
            id,
            variant_id,
            change_type,
            quantity_change,
            previous_physical,
            new_physical,
            previous_reserved,
            new_reserved,
            reference_id,
            notes,
            created_at,
            product_variants (
                id,
                size,
                products (
                    id,
                    name_en
                )
            )
        `)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

    if (variantId) {
        query = query.eq("variant_id", variantId);
    }

    const { data, error } = await query;

    if (error) {
        const err = new Error("Failed to fetch inventory audit logs");
        err.details = error.message;
        throw err;
    }

    return data || [];
};

module.exports = {
    recordStoreSale,
    adjustStock,
    getAuditLogs
};
