const categoryService = require("../services/categoryService");
const { sendSuccess } = require("../utils/responseUtils");

// Get Public Active Categories
const getCategories = async (req, res, next) => {
    try {
        const categories = await categoryService.getActiveCategories();
        return sendSuccess(res, categories, "Categories fetched");
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getCategories
};
