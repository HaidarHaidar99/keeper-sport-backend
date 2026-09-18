const exchangeService = require("../services/exchangeService");
const { sendSuccess } = require("../utils/responseUtils");

// Customer/Guest submits an exchange request
const requestExchange = async (req, res, next) => {
    try {
        const customerId = req.customer ? req.customer.id : null;
        const { order_id, order_item_id, replacement_variant_id, reason } = req.body;

        const exchange = await exchangeService.requestExchange({
            orderId: order_id,
            orderItemId: order_item_id,
            customerId,
            replacementVariantId: replacement_variant_id,
            reason
        });

        return sendSuccess(res, exchange, "Exchange request submitted successfully", 201);
    } catch (err) {
        next(err);
    }
};

// Customer retrieves their exchange history
const getCustomerExchanges = async (req, res, next) => {
    try {
        const exchanges = await exchangeService.getExchanges({ customerId: req.customer.id });
        return sendSuccess(res, exchanges, "Exchanges fetched");
    } catch (err) {
        next(err);
    }
};

module.exports = {
    requestExchange,
    getCustomerExchanges
};
