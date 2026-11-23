const express = require("express");
const router = express.Router();
const { optionalAuth } = require("../middleware/authMiddleware");
const {
  toggleFavorite,
  getUserFavoriteIds,
  getFavoriteProducts,
  clearFavorites
} = require("../controllers/favoriteController");

router.get("/", optionalAuth, getFavoriteProducts);
router.post("/toggle", optionalAuth, toggleFavorite);
router.get("/ids", optionalAuth, getUserFavoriteIds);
router.delete("/", optionalAuth, clearFavorites);
router.post("/clear", optionalAuth, clearFavorites);

module.exports = router;
