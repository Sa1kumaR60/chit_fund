const express = require("express");
const { authMiddleware, requireRole } = require("../middleware/authMiddleware");
const {
  getAdminDashboard,
  getMemberDashboard,
  getMonthlyReports,
} = require("../controllers/dashboardController");

const router = express.Router();

router.get("/admin", authMiddleware, requireRole("ADMIN"), getAdminDashboard);
router.get("/member", authMiddleware, requireRole("MEMBER"), getMemberDashboard);
router.get("/reports", authMiddleware, requireRole("ADMIN"), getMonthlyReports);

module.exports = router;
