const express = require("express");
const router = express.Router();
const { optionalAuth } = require("../middleware/authMiddleware");
const {
  toggleFavorite,
  getUserFavoriteIds,
  clearFavorites
} = require("../controllers/favoriteController");

router.post("/toggle", optionalAuth, toggleFavorite);
router.get("/ids", optionalAuth, getUserFavoriteIds);
router.delete("/", optionalAuth, clearFavorites);
router.post("/clear", optionalAuth, clearFavorites);

module.exports = router;
