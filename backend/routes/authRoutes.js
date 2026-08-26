const express = require("express");
const router = express.Router();
const { authMiddleware, requireRole } = require("../middleware/authMiddleware");
const { passwordResetRateLimiter } = require("../middleware/rateLimiter");
const authController = require("../controllers/authController");

router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/kyc", authMiddleware, authController.submitKyc);

// Password Reset Routes with Rate Limiting
router.post("/forgot-password", passwordResetRateLimiter, authController.requestPasswordReset);
router.post("/verify-reset-otp", passwordResetRateLimiter, authController.verifyResetOtp);
router.post("/reset-password", passwordResetRateLimiter, authController.resetPassword);
router.post("/admin/reset-member-password", authMiddleware, requireRole("ADMIN"), authController.adminInitiatedReset);

module.exports = router;