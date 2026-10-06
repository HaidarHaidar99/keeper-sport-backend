const express = require("express");
const router = express.Router();
const { optionalAuth } = require("../middleware/authMiddleware");
const {
  addToCart,
  getCart,
  updateCartItemQuantity,
  removeCartItem
} = require("../controllers/cartController");

router.get("/", optionalAuth, getCart);
router.post("/add", optionalAuth, addToCart);
router.put("/items/:itemId", optionalAuth, updateCartItemQuantity);
router.delete("/items/:itemId", optionalAuth, removeCartItem);

module.exports = router;
