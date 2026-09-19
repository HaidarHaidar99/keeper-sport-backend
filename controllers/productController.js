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

// Create Product (Admin)
const createProduct = async (req, res, next) => {
    try {
        const product = await productService.createProduct(req.body);
        return sendSuccess(res, product, "Product created successfully", 201);
    } catch (err) {
        next(err);
    }
};

// Update Product (Admin)
const updateProduct = async (req, res, next) => {
    try {
        const product = await productService.updateProduct(req.params.id, req.body);
        return sendSuccess(res, product, "Product updated successfully");
    } catch (err) {
        next(err);
    }
};

// Delete / Deactivate Product (Admin)
const deleteProduct = async (req, res, next) => {
    try {
        const result = await productService.deleteProduct(req.params.id);
        return sendSuccess(res, result, "Product deactivated successfully");
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct
};
