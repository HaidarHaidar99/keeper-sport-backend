const express = require("express");
const router = express.Router();
const { optionalAuth } = require("../middleware/authMiddleware");
const {
  getProducts,
  getFeaturedProducts,
  getProductBySlugOrId
} = require("../controllers/productController");

// Dynamic featured products rail
router.get("/featured", optionalAuth, getFeaturedProducts);

// Catalog listing with filters, search, sort, pagination
router.get("/", optionalAuth, getProducts);

// Single product details
router.get("/:slugOrId", optionalAuth, getProductBySlugOrId);

module.exports = router;
