const bcrypt = require("bcryptjs");
const supabase = require("../config/supabase");
const inventoryService = require("../services/inventoryService");
const orderService = require("../services/orderService");
const reviewService = require("../services/reviewService");
const exchangeService = require("../services/exchangeService");
const contentService = require("../services/contentService");
const { sendSuccess } = require("../utils/responseUtils");

// 1. Dashboard Overview Stats
const getDashboardStats = async (req, res, next) => {
    try {
        const { count: pendingOrders } = await supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("order_status", "Pending");

        const { count: pendingReviews } = await supabase
            .from("reviews")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending");

        const { count: unreadMessages } = await supabase
            .from("contact_messages")
            .select("id", { count: "exact", head: true })
            .eq("is_read", false);

        const { count: pendingExchanges } = await supabase
            .from("order_exchanges")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending");

        // Low stock items where physical_stock - reserved_stock <= 2
        const { data: lowStockVariants } = await supabase
            .from("product_variants")
            .select(`
                id,
                size,
                physical_stock,
                reserved_stock,
                available_stock,
                products (
                    id,
                    name_en
                )
            `)
            .eq("track_quantity", true)
            .lte("available_stock", 2)
            .limit(10);

        return sendSuccess(res, {
            pending_orders: pendingOrders || 0,
            pending_reviews: pendingReviews || 0,
            unread_messages: unreadMessages || 0,
            pending_exchanges: pendingExchanges || 0,
            low_stock_alerts: lowStockVariants || []
        }, "Dashboard stats fetched");
    } catch (err) {
        next(err);
    }
};

// 2. Physical Store POS Sale (Atomic Procedure)
const recordStoreSale = async (req, res, next) => {
    try {
        const { variant_id, quantity, notes } = req.body;
        const result = await inventoryService.recordStoreSale({
            variantId: variant_id,
            quantity,
            adminId: req.admin.id,
            notes
        });
        return sendSuccess(res, result, "Physical store sale recorded successfully", 201);
    } catch (err) {
        next(err);
    }
};

// 3. Stock Adjustment / Restock
const adjustStock = async (req, res, next) => {
    try {
        const { variant_id, physical_change, reason, notes } = req.body;
        const result = await inventoryService.adjustStock({
            variantId: variant_id,
            physicalChange: physical_change,
            reason,
            adminId: req.admin.id,
            notes
        });
        return sendSuccess(res, result, "Stock adjusted successfully");
    } catch (err) {
        next(err);
    }
};

// 4. Inventory Audit Logs
const getInventoryLogs = async (req, res, next) => {
    try {
        const { variant_id, limit, offset } = req.query;
        const logs = await inventoryService.getAuditLogs({
            variantId: variant_id,
            limit: limit ? parseInt(limit, 10) : 50,
            offset: offset ? parseInt(offset, 10) : 0
        });
        return sendSuccess(res, logs, "Inventory logs fetched");
    } catch (err) {
        next(err);
    }
};

// 5. Orders Management
const getAllOrders = async (req, res, next) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10));
        const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
        const offset = (pageNum - 1) * limitNum;

        let query = supabase
            .from("orders")
            .select(`
                id,
                order_number,
                customer_id,
                delivery_phone,
                delivery_city,
                delivery_address,
                total_amount,
                payment_method,
                payment_status,
                order_status,
                rejection_reason,
                created_at,
                order_items (
                    id,
                    product_name_snapshot,
                    size_snapshot,
                    quantity,
                    unit_price,
                    total_price
                )
            `, { count: "exact" })
            .order("created_at", { ascending: false })
            .range(offset, offset + limitNum - 1);

        if (status) {
            query = query.eq("order_status", status);
        }

        const { data, count, error } = await query;
        if (error) throw error;

        return sendSuccess(res, data || [], "Orders fetched", 200, {
            page: pageNum,
            limit: limitNum,
            totalItems: count || 0,
            totalPages: Math.ceil((count || 0) / limitNum)
        });
    } catch (err) {
        next(err);
    }
};

const updateOrderStatus = async (req, res, next) => {
    try {
        const { order_status, payment_status, rejection_reason, admin_notes } = req.body;
        const updated = await orderService.updateOrderStatus(req.params.id, {
            order_status,
            payment_status,
            rejection_reason,
            admin_notes
        });
        return sendSuccess(res, updated, "Order status updated");
    } catch (err) {
        next(err);
    }
};

// 6. Reviews Moderation
const getPendingReviews = async (req, res, next) => {
    try {
        const { status = "pending", page, limit } = req.query;
        const result = await reviewService.getAdminReviews({ status, page, limit });
        return sendSuccess(res, result.reviews, "Reviews fetched", 200, result.pagination);
    } catch (err) {
        next(err);
    }
};

const updateReviewStatus = async (req, res, next) => {
    try {
        const { status } = req.body;
        const updated = await reviewService.updateReviewStatus(req.params.id, status);
        return sendSuccess(res, updated, `Review ${status}`);
    } catch (err) {
        next(err);
    }
};

// 7. Exchanges Moderation
const getAllExchanges = async (req, res, next) => {
    try {
        const { status } = req.query;
        const exchanges = await exchangeService.getExchanges({ status });
        return sendSuccess(res, exchanges, "Exchanges fetched");
    } catch (err) {
        next(err);
    }
};

const updateExchangeStatus = async (req, res, next) => {
    try {
        const { status, decline_reason, admin_notes } = req.body;
        const updated = await exchangeService.updateExchangeStatus(req.params.id, {
            status,
            decline_reason,
            admin_notes
        });
        return sendSuccess(res, updated, "Exchange status updated");
    } catch (err) {
        next(err);
    }
};

// 8. Contact Messages
const getContactMessages = async (req, res, next) => {
    try {
        const messages = await contentService.getContactMessages();
        return sendSuccess(res, messages, "Messages fetched");
    } catch (err) {
        next(err);
    }
};

const markContactMessageRead = async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from("contact_messages")
            .update({ is_read: true })
            .eq("id", req.params.id)
            .select()
            .single();

        if (error) throw error;
        return sendSuccess(res, data, "Message marked as read");
    } catch (err) {
        next(err);
    }
};

// 9. Super Admin Team Management
const listAdmins = async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from("admins")
            .select("id, email, role, is_active, created_at")
            .order("created_at", { ascending: false });

        if (error) throw error;
        return sendSuccess(res, data || [], "Admins list fetched");
    } catch (err) {
        next(err);
    }
};

const createAdmin = async (req, res, next) => {
    try {
        const { email, password, role = "admin" } = req.body;
        const cleanEmail = email.toLowerCase().trim();

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        const { data, error } = await supabase
            .from("admins")
            .insert([{
                email: cleanEmail,
                password_hash,
                role,
                is_active: true
            }])
            .select("id, email, role, is_active, created_at")
            .single();

        if (error) throw error;
        return sendSuccess(res, data, "Administrator created successfully", 201);
    } catch (err) {
        next(err);
    }
};

const deleteAdmin = async (req, res, next) => {
    try {
        // Prevent deleting oneself
        if (req.params.id === req.admin.id) {
            const err = new Error("Cannot delete your own super admin account");
            err.statusCode = 400;
            throw err;
        }

        const { error } = await supabase
            .from("admins")
            .delete()
            .eq("id", req.params.id);

        if (error) throw error;
        return sendSuccess(res, null, "Administrator deleted successfully");
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getDashboardStats,
    recordStoreSale,
    adjustStock,
    getInventoryLogs,
    getAllOrders,
    updateOrderStatus,
    getPendingReviews,
    updateReviewStatus,
    getAllExchanges,
    updateExchangeStatus,
    getContactMessages,
    markContactMessageRead,
    listAdmins,
    createAdmin,
    deleteAdmin
};
