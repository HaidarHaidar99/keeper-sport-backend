const productService = require("../services/productService");
const { sendSuccess } = require("../utils/responseUtils");

// Get Products Catalog
const getProducts = async (req, res, next) => {
    try {
        const result = await productService.getProducts(req.query);
        return sendSuccess(res, result.products, "Products fetched", 200, result.pagination);
    } catch (err) {
        next(err);
    }
};

// Get Single Product Details
const getProductById = async (req, res, next) => {
    try {
        const product = await productService.getProductById(req.params.id);
        return sendSuccess(res, product, "Product details fetched");
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getProducts,
    getProductById
};
