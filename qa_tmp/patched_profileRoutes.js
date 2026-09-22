const express = require("C:/Users/saiku/OneDrive/Desktop/chit_fund/backend/node_modules/express");
const router = express.Router();
const { authMiddleware, requireRole } = require("C:/Users/saiku/OneDrive/Desktop/chit_fund/backend/middleware/authMiddleware");
const profileController = require("C:/Users/saiku/OneDrive/Desktop/chit_fund/backend/controllers/profileController");
const kycController = require("C:/Users/saiku/OneDrive/Desktop/chit_fund/backend/controllers/kycController");
const kycAdminController = require("C:/Users/saiku/OneDrive/Desktop/chit_fund/backend/controllers/kycAdminController");

// Member & Shared Profile Routes
router.get("/", authMiddleware, profileController.getProfile);
router.put("/", authMiddleware, profileController.updateProfile);

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
