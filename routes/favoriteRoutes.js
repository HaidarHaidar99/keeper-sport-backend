const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const {
  toggleFavorite,
  getUserFavoriteIds
} = require("../controllers/favoriteController");

router.post("/toggle", requireAuth, toggleFavorite);
router.get("/ids", requireAuth, getUserFavoriteIds);

module.exports = router;
