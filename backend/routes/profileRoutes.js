const express = require("express");
const router = express.Router();
const { authMiddleware, requireRole } = require("../middleware/authMiddleware");
const profileController = require("../controllers/profileController");
const kycController = require("../controllers/kycController");
const kycAdminController = require("../controllers/kycAdminController");

const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
});

// Member & Shared Profile Routes
router.get("/", authMiddleware, profileController.getProfile);
router.put("/", authMiddleware, profileController.updateProfile);
router.post("/avatar", authMiddleware, upload.single("avatar"), profileController.uploadAvatar);
router.delete("/avatar", authMiddleware, profileController.deleteAvatar);

// Provider-Independent Digital KYC Routes
router.post("/kyc/initiate", authMiddleware, kycController.initiateKycSession);
router.get("/kyc/callback", authMiddleware, kycController.handleKycCallback);
router.post("/kyc/callback", authMiddleware, kycController.handleKycCallback);
router.get("/kyc/status", authMiddleware, kycController.getKycStatus);

// Existing Legacy/Manual KYC Routes (Preserved for manual admin upload if needed)
router.post("/kyc", authMiddleware, profileController.submitKyc);
router.get("/kyc", authMiddleware, profileController.getKycDetails);
router.get("/kyc/document/:kycId", authMiddleware, profileController.streamPrivateKycDocument);

// Notification Preferences Routes
router.get("/notification-preferences", authMiddleware, profileController.getNotificationPreferences);
router.put("/notification-preferences", authMiddleware, profileController.updateNotificationPreferences);

// Active Sessions Routes
router.get("/sessions", authMiddleware, profileController.getActiveSessions);
router.post("/sessions/logout-session", authMiddleware, profileController.logoutSession);
router.post("/sessions/logout-other-devices", authMiddleware, profileController.logoutOtherDevices);

// Account Deactivation
router.post("/deactivate", authMiddleware, profileController.deactivateAccount);

// Admin-Only Profile Routes
router.get("/settlement-account", authMiddleware, requireRole("ADMIN"), profileController.getAdminSettlementAccount);
router.put("/settlement-account", authMiddleware, requireRole("ADMIN"), profileController.updateAdminSettlementAccount);

router.get("/chit-defaults", authMiddleware, requireRole("ADMIN"), profileController.getAdminChitDefaults);
router.put("/chit-defaults", authMiddleware, requireRole("ADMIN"), profileController.updateAdminChitDefaults);

router.get("/admin/kyc-queue", authMiddleware, requireRole("ADMIN"), kycAdminController.getPendingKycQueue);
router.post("/admin/review-kyc", authMiddleware, requireRole("ADMIN"), kycAdminController.reviewMemberKyc);

module.exports = router;
