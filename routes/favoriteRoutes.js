const express = require("express");
const router = express.Router();
const { optionalAuth } = require("../middleware/authMiddleware");
const {
  toggleFavorite,
  getUserFavoriteIds
} = require("../controllers/favoriteController");

router.post("/toggle", optionalAuth, toggleFavorite);
router.get("/ids", optionalAuth, getUserFavoriteIds);

module.exports = router;
