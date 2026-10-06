const express = require("express");
const router = express.Router();
const contentController = require("../controllers/contentController");
const { optionalAuth } = require("../middleware/authMiddleware");

// Public Content Endpoints
router.get("/site-settings", contentController.getSiteSettings);
router.get("/hero-slides", contentController.getHeroSlides);
router.get("/offer-bars", contentController.getOfferBars);
router.get("/categories", contentController.getCategories);
router.get("/offers", contentController.getOffers);
router.get("/reviews", contentController.getPublicReviews);
router.post("/contact", optionalAuth, contentController.submitContactMessage);

// User Counts Endpoint (Optional Auth: returns 0s for guests, real counts for authenticated users)
router.get("/user/counts", optionalAuth, contentController.getUserCounts);

module.exports = router;

