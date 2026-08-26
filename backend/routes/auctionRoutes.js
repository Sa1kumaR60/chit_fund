const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const {
  startAuction,
  placeBid,
  calculateAuctionResult,
  getAuctionDetails,
} = require("../controllers/auctionController");

const router = express.Router();

router.post("/start", authMiddleware, startAuction);
router.get("/:auctionId", authMiddleware, getAuctionDetails);
router.post("/:auctionId/bids", authMiddleware, placeBid);
router.post("/:auctionId/calculate", authMiddleware, calculateAuctionResult);

module.exports = router;
