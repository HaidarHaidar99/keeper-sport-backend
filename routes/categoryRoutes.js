const express = require("express");
const router = express.Router();
const categoryController = require("../controllers/categoryController");

// Public Categories
router.get("/", categoryController.getCategories);

module.exports = router;
