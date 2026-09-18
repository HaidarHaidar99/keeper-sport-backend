const express = require("express");
const router = express.Router();
const contentController = require("../controllers/contentController");
const { validateRequired, validateEmail } = require("../middleware/validationMiddleware");

// Settings, Hero Slides, Timed Offers
router.get("/settings", contentController.getSettings);
router.get("/hero-slides", contentController.getHeroSlides);
router.get("/offers", contentController.getOffers);

// Contact Message
router.post(
    "/contact",
    validateRequired(["name", "phone", "email", "message"]),
    validateEmail("email"),
    contentController.submitContact
);

module.exports = router;
