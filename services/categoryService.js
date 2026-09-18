const supabase = require("../config/supabase");

// Public Active Categories
const getActiveCategories = async () => {
    const { data, error } = await supabase
        .from("categories")
        .select("id, name_en, name_ar, description_en, description_ar, image_url, display_order")
        .eq("is_active", true)
        .order("display_order", { ascending: true });

    if (error) {
        const err = new Error("Failed to fetch categories");
        err.details = error.message;
        throw err;
    }

    return data || [];
};

// Admin Categories View
const getAllCategoriesAdmin = async () => {
    const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("display_order", { ascending: true });

    if (error) {
        const err = new Error("Failed to fetch categories");
        err.details = error.message;
        throw err;
    }

    return data || [];
};

// Create Category (Admin)
const createCategory = async (categoryData) => {
    const { data, error } = await supabase
        .from("categories")
        .insert([categoryData])
        .select()
        .single();

    if (error) {
        const err = new Error("Failed to create category");
        err.details = error.message;
        throw err;
    }

    return data;
};

// Update Category (Admin)
const updateCategory = async (id, updates) => {
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase
        .from("categories")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

    if (error) {
        const err = new Error("Failed to update category");
        err.details = error.message;
        throw err;
    }

    return data;
};

module.exports = {
    getActiveCategories,
    getAllCategoriesAdmin,
    createCategory,
    updateCategory
};
