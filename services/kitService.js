const supabase = require("../config/supabase");

// Get Active Kits for Custom Kit Designer
const getActiveKits = async () => {
    const { data, error } = await supabase
        .from("kits")
        .select(`
            id,
            club_name,
            kit_name,
            season,
            front_image_url,
            back_image_url,
            base_price,
            is_name_allowed,
            is_number_allowed,
            name_number_price
        `)
        .eq("is_active", true)
        .order("club_name", { ascending: true });

    if (error) {
        const err = new Error("Failed to fetch kits");
        err.details = error.message;
        throw err;
    }

    return data || [];
};

// Get Full Kit Details for 2D Interactive Canvas
const getKitById = async (id) => {
    const { data: kit, error: kitErr } = await supabase
        .from("kits")
        .select(`
            id,
            club_name,
            kit_name,
            season,
            front_image_url,
            back_image_url,
            base_price,
            is_name_allowed,
            is_number_allowed,
            name_number_price,
            name_style_config,
            number_style_config,
            is_active,
            kit_variants (
                id,
                size,
                price_override,
                track_quantity,
                available_stock,
                is_available
            ),
            kit_options (
                id,
                badge_name,
                badge_image_url,
                price,
                position_config,
                is_active
            )
        `)
        .eq("id", id)
        .eq("is_active", true)
        .single();

    if (kitErr || !kit) {
        const err = new Error("Kit not found");
        err.statusCode = 404;
        throw err;
    }

    // Filter active badges
    const activeOptions = (kit.kit_options || []).filter(opt => opt.is_active);

    return {
        ...kit,
        kit_options: activeOptions
    };
};

// Admin Create Kit
const createKit = async (kitData) => {
    const { data, error } = await supabase
        .from("kits")
        .insert([kitData])
        .select()
        .single();

    if (error) {
        const err = new Error("Failed to create kit");
        err.details = error.message;
        throw err;
    }

    return data;
};

// Admin Update Kit
const updateKit = async (id, updates) => {
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase
        .from("kits")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

    if (error) {
        const err = new Error("Failed to update kit");
        err.details = error.message;
        throw err;
    }

    return data;
};

module.exports = {
    getActiveKits,
    getKitById,
    createKit,
    updateKit
};
