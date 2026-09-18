const bcrypt = require("bcryptjs");
const supabase = require("../config/supabase");
const { signJwt } = require("../utils/tokenUtils");

// Admin Login
const adminLogin = async (email, password) => {
    const { data: admin, error } = await supabase
        .from("admins")
        .select("id, email, password_hash, role, is_active")
        .eq("email", email.toLowerCase().trim())
        .single();

    if (error || !admin) {
        const err = new Error("Invalid email or password");
        err.statusCode = 401;
        throw err;
    }

    if (!admin.is_active) {
        const err = new Error("This administrator account has been deactivated");
        err.statusCode = 403;
        throw err;
    }

    const isValid = await bcrypt.compare(password, admin.password_hash);
    if (!isValid) {
        const err = new Error("Invalid email or password");
        err.statusCode = 401;
        throw err;
    }

    const token = signJwt({
        id: admin.id,
        email: admin.email,
        role: admin.role
    });

    return {
        token,
        admin: {
            id: admin.id,
            email: admin.email,
            role: admin.role
        }
    };
};

// Customer Registration (Email + Password only as required by Section 7)
const customerRegister = async (email, password) => {
    const cleanEmail = email.toLowerCase().trim();

    // Check if customer already exists
    const { data: existing } = await supabase
        .from("customers")
        .select("id")
        .eq("email", cleanEmail)
        .single();

    if (existing) {
        const err = new Error("An account with this email already exists");
        err.statusCode = 409;
        throw err;
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const { data: newCustomer, error } = await supabase
        .from("customers")
        .insert([{
            email: cleanEmail,
            password_hash,
            is_verified: false
        }])
        .select("id, email, is_verified, created_at")
        .single();

    if (error) {
        const err = new Error("Failed to register customer");
        err.details = error.message;
        throw err;
    }

    const token = signJwt({
        id: newCustomer.id,
        email: newCustomer.email,
        role: "customer"
    });

    return {
        token,
        customer: newCustomer
    };
};

// Customer Login
const customerLogin = async (email, password) => {
    const cleanEmail = email.toLowerCase().trim();

    const { data: customer, error } = await supabase
        .from("customers")
        .select("id, email, password_hash, is_verified, saved_phone, saved_city, saved_address, saved_live_location")
        .eq("email", cleanEmail)
        .single();

    if (error || !customer) {
        const err = new Error("Invalid email or password");
        err.statusCode = 401;
        throw err;
    }

    const isValid = await bcrypt.compare(password, customer.password_hash);
    if (!isValid) {
        const err = new Error("Invalid email or password");
        err.statusCode = 401;
        throw err;
    }

    const token = signJwt({
        id: customer.id,
        email: customer.email,
        role: "customer"
    });

    return {
        token,
        customer: {
            id: customer.id,
            email: customer.email,
            is_verified: customer.is_verified,
            saved_phone: customer.saved_phone,
            saved_city: customer.saved_city,
            saved_address: customer.saved_address,
            saved_live_location: customer.saved_live_location
        }
    };
};

// Get Customer Profile
const getCustomerProfile = async (customerId) => {
    const { data: customer, error } = await supabase
        .from("customers")
        .select("id, email, is_verified, saved_phone, saved_city, saved_address, saved_live_location, created_at")
        .eq("id", customerId)
        .single();

    if (error || !customer) {
        const err = new Error("Customer profile not found");
        err.statusCode = 404;
        throw err;
    }

    return customer;
};

// Update Customer Profile (Optional Saved Checkout Convenience Defaults)
const updateCustomerProfile = async (customerId, updates) => {
    const allowed = ["saved_phone", "saved_city", "saved_address", "saved_live_location"];
    const payload = {};
    for (const key of allowed) {
        if (updates[key] !== undefined) {
            payload[key] = updates[key];
        }
    }
    payload.updated_at = new Date().toISOString();

    const { data, error } = await supabase
        .from("customers")
        .update(payload)
        .eq("id", customerId)
        .select("id, email, is_verified, saved_phone, saved_city, saved_address, saved_live_location")
        .single();

    if (error) {
        const err = new Error("Failed to update profile");
        err.details = error.message;
        throw err;
    }

    return data;
};

module.exports = {
    adminLogin,
    customerRegister,
    customerLogin,
    getCustomerProfile,
    updateCustomerProfile
};
