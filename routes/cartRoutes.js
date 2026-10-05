const express = require("express");
const router = express.Router();
const { optionalAuth } = require("../middleware/authMiddleware");
const {
  addToCart,
  getCart
} = require("../controllers/cartController");

router.get("/", optionalAuth, getCart);
router.post("/add", optionalAuth, addToCart);

module.exports = router;
