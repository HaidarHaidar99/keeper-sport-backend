const supabase = require("../config/supabase");

// Website Settings
const getWebsiteSettings = async () => {
    const { data, error } = await supabase
        .from("website_settings")
        .select("*")
        .eq("id", 1)
        .single();

    if (error) {
        const err = new Error("Failed to fetch website settings");
        err.details = error.message;
        throw err;
    }

    return data;
};

const updateWebsiteSettings = async (settingsData) => {
    settingsData.updated_at = new Date().toISOString();
    const { data, error } = await supabase
        .from("website_settings")
        .update(settingsData)
        .eq("id", 1)
        .select()
        .single();

    if (error) {
        const err = new Error("Failed to update website settings");
        err.details = error.message;
        throw err;
    }

    return data;
};

// Hero Slides (Public Active Slides)
const getHeroSlides = async () => {
    const { data, error } = await supabase
        .from("hero_slides")
        .select("id, title_en, title_ar, subtitle_en, subtitle_ar, media_url, media_type, display_order")
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .limit(3);

    if (error) {
        const err = new Error("Failed to fetch hero slides");
        err.details = error.message;
        throw err;
    }

    return data || [];
};

// Timed Offers (Public Active & Valid Timestamps)
const getOffers = async () => {
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from("offers")
        .select(`
            id,
            title_en,
            title_ar,
            description_en,
            description_ar,
            old_price,
            new_price,
            product_id,
            button_link,
            starts_at,
            expires_at
        `)
        .eq("is_active", true)
        .lte("starts_at", now)
        .gte("expires_at", now)
        .order("starts_at", { ascending: false });

    if (error) {
        const err = new Error("Failed to fetch offers");
        err.details = error.message;
        throw err;
    }

    return data || [];
};

// Contact Messages
const submitContactMessage = async ({ name, phone, email, message }) => {
    const { data, error } = await supabase
        .from("contact_messages")
        .insert([{
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim(),
            message: message.trim(),
            is_read: false
        }])
        .select()
        .single();

    if (error) {
        const err = new Error("Failed to submit contact message");
        err.details = error.message;
        throw err;
    }

    return data;
};

const getContactMessages = async () => {
    const { data, error } = await supabase
        .from("contact_messages")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        const err = new Error("Failed to fetch contact messages");
        err.details = error.message;
        throw err;
    }

    return data || [];
};

module.exports = {
    getWebsiteSettings,
    updateWebsiteSettings,
    getHeroSlides,
    getOffers,
    submitContactMessage,
    getContactMessages
};
