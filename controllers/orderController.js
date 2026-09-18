const orderService = require("../services/orderService");
const { sendSuccess } = require("../utils/responseUtils");

// Checkout / Place Order
const createOrder = async (req, res, next) => {
    try {
        const customerId = req.customer ? req.customer.id : null;
        const { delivery, items, paymentMethod } = req.body;

        const result = await orderService.createOrder({
            customerId,
            delivery,
            items,
            paymentMethod
        });

        return sendSuccess(res, result, "Order placed successfully", 201);
    } catch (err) {
        next(err);
    }
};

// Retrieve Guest Orders via X-Guest-Token Header
const getGuestOrders = async (req, res, next) => {
    try {
        const rawGuestToken = req.headers["x-guest-token"];
        const orders = await orderService.getGuestOrders(rawGuestToken);
        return sendSuccess(res, orders, "Guest orders fetched");
    } catch (err) {
        next(err);
    }
};

// Retrieve Customer Order History
const getCustomerOrders = async (req, res, next) => {
    try {
        const orders = await orderService.getCustomerOrders(req.customer.id);
        return sendSuccess(res, orders, "Customer orders fetched");
    } catch (err) {
        next(err);
    }
};

// Get Single Order Details
const getOrderById = async (req, res, next) => {
    try {
        const rawGuestToken = req.headers["x-guest-token"] || null;
        const customerId = req.customer ? req.customer.id : null;
        const isAdmin = Boolean(req.admin);

        const order = await orderService.getOrderById(req.params.id, {
            isAdmin,
            customerId,
            rawGuestToken
        });

        return sendSuccess(res, order, "Order details fetched");
    } catch (err) {
        next(err);
    }
};

module.exports = {
    createOrder,
    getGuestOrders,
    getCustomerOrders,
    getOrderById
};
