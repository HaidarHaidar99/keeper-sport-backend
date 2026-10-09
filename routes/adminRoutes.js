const express = require("express");
const multer = require("multer");
const router = express.Router();
const { requireAdmin } = require("../middleware/authMiddleware");
const adminController = require("../controllers/adminController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max
});

// All admin routes strictly require valid admin session
router.use(requireAdmin);

// Dashboard
router.get("/dashboard", adminController.getDashboardOverview);

// Media Upload
router.post("/upload", upload.single("file"), adminController.uploadMedia);

// Home Management
router.get("/home/overview", adminController.getHomeOverview);
router.get("/hero-slides", adminController.getHeroSlidesAdmin);
router.post("/hero-slides", adminController.createHeroSlide);
router.put("/hero-slides/:id", adminController.updateHeroSlide);
router.delete("/hero-slides/:id", adminController.deleteHeroSlide);

router.get("/offer-bars", adminController.getOfferBarsAdmin);
router.post("/offer-bars", adminController.createOfferBar);
router.put("/offer-bars/:id", adminController.updateOfferBar);
router.delete("/offer-bars/:id", adminController.deleteOfferBar);

// Settings & Content
router.get("/settings", adminController.getSiteSettingsAdmin);
router.put("/settings", adminController.updateSiteSettingsAdmin);
router.get("/homepage-story", adminController.getHomepageStoryAdmin);
router.put("/homepage-story", adminController.updateHomepageStoryAdmin);
router.get("/location", adminController.getLocationSettingsAdmin);
router.put("/location", adminController.updateLocationSettingsAdmin);
router.get("/social-media", adminController.getSocialSettingsAdmin);
router.put("/social-media", adminController.updateSocialSettingsAdmin);

// Offers (Products & Categories Discounts)
router.get("/offers", adminController.getOffersAdmin);
router.post("/offers", adminController.createOfferAdmin);
router.put("/offers/:id", adminController.updateOfferAdmin);
router.delete("/offers/:id", adminController.deleteOfferAdmin);

// Products
router.get("/products/overview", adminController.getProductsOverview);
router.get("/products", adminController.getProductsAdmin);
router.get("/products/:id", adminController.getProductByIdAdmin);
router.post("/products", adminController.createProduct);
router.put("/products/:id", adminController.updateProduct);
router.delete("/products/:id", adminController.deleteProduct);

// Categories
router.get("/categories", adminController.getCategoriesAdmin);
router.post("/categories", adminController.createCategory);
router.put("/categories/:id", adminController.updateCategory);
router.delete("/categories/:id", adminController.deleteCategory);

// Orders
router.get("/orders", adminController.getOrdersAdmin);
router.patch("/orders/:id/status", adminController.updateOrderStatus);

// Users
router.get("/users", adminController.getUsersAdmin);
router.patch("/users/:id/role", adminController.updateUserRole);

// Reviews
router.get("/reviews", adminController.getReviewsAdmin);
router.patch("/reviews/:id/visibility", adminController.toggleReviewVisibility);
router.delete("/reviews/:id", adminController.deleteReview);

// Notifications
router.get("/notifications", adminController.getNotificationsAdmin);
router.patch("/notifications/:id/read", adminController.markNotificationRead);
router.post("/notifications/mark-all-read", adminController.markAllNotificationsRead);

// Contact Messages / Forms
router.get("/forms", adminController.getContactFormsAdmin);
router.patch("/forms/:id/read", adminController.markContactFormReadAdmin);
router.delete("/forms/:id", adminController.deleteContactFormAdmin);
router.get("/contact-messages", adminController.getContactFormsAdmin);
router.patch("/contact-messages/:id/read", adminController.markContactFormReadAdmin);
router.delete("/contact-messages/:id", adminController.deleteContactFormAdmin);

module.exports = router;
