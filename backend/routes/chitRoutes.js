const express = require("express");
const { authMiddleware, requireRole } = require("../middleware/authMiddleware");
const {
  createWizardChit,
  saveMonthlyRules,
  configureMemberSlots,
  getFinancialSimulationPreview,
  activateChit,
  claimInvitationByToken,
  getChits,
  getChitDetails,
  getInvitations,
} = require("../controllers/chitController");

const router = express.Router();

// General list & details
router.get("/", authMiddleware, getChits);
router.get("/invitations/me", authMiddleware, getInvitations);
router.post("/claim-invite", authMiddleware, claimInvitationByToken);
router.post("/invitations/:invitationId/accept", authMiddleware, claimInvitationByToken);

// Wizard endpoints (Admin)
router.post("/wizard/create", authMiddleware, requireRole("ADMIN"), createWizardChit);
router.post("/wizard/:chitId/rules", authMiddleware, requireRole("ADMIN"), saveMonthlyRules);
router.post("/wizard/:chitId/slots", authMiddleware, requireRole("ADMIN"), configureMemberSlots);
router.get("/wizard/:chitId/simulation", authMiddleware, requireRole("ADMIN"), getFinancialSimulationPreview);
router.post("/wizard/:chitId/activate", authMiddleware, requireRole("ADMIN"), activateChit);

// Backward compatible creation endpoint
router.post("/", authMiddleware, requireRole("ADMIN"), createWizardChit);
router.get("/:chitId", authMiddleware, getChitDetails);

module.exports = router;
