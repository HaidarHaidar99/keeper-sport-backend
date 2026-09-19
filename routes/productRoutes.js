const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const { authenticateAdmin } = require("../middleware/authMiddleware");

// Public Product Catalog
router.get("/", productController.getProducts);
router.get("/:id", productController.getProductById);

// Admin Product Management
router.post("/", authenticateAdmin, productController.createProduct);
router.put("/:id", authenticateAdmin, productController.updateProduct);
router.delete("/:id", authenticateAdmin, productController.deleteProduct);

module.exports = router;
