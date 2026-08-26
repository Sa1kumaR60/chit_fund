const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const { makePayment, getPaymentStatus } = require("../controllers/paymentController");

const router = express.Router();

router.post("/", authMiddleware, makePayment);
router.get("/status/:chitId", authMiddleware, getPaymentStatus);

module.exports = router;
