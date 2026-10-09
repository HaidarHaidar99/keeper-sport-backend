const express = require("express");
const router = express.Router();
const { optionalAuth } = require("../middleware/authMiddleware");
const {
  addToCart,
  getCart,
  updateCartItemQuantity,
  updateCartItemVariant,
  removeCartItem,
  clearCart
} = require("../controllers/cartController");

router.get("/", optionalAuth, getCart);
router.post("/add", optionalAuth, addToCart);
router.put("/items/:itemId", optionalAuth, updateCartItemQuantity);
router.put("/items/:itemId/variant", optionalAuth, updateCartItemVariant);
router.delete("/items/:itemId", optionalAuth, removeCartItem);
router.delete("/", optionalAuth, clearCart);
router.post("/clear", optionalAuth, clearCart);

module.exports = router;
