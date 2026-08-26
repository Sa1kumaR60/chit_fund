const express = require("express");
const router = express.Router();
const { getWalletDetails, addFunds } = require("../controllers/walletController");
const { authMiddleware } = require("../middleware/authMiddleware");

router.use(authMiddleware);

router.get("/me", getWalletDetails);
router.post("/add-funds", addFunds);

module.exports = router;
