const express = require("express");
const router = express.Router();
const kitController = require("../controllers/kitController");

// Public Kits
router.get("/", kitController.getKits);
router.get("/:id", kitController.getKitById);

module.exports = router;
