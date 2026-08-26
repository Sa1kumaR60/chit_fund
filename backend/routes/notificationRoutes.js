const express = require("express");
const { getNotifications, markAsRead, sendReminder } = require("../controllers/notificationController");
const { authMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", authMiddleware, getNotifications);
router.put("/:notificationId/read", authMiddleware, markAsRead);
router.post("/remind/:memberId", authMiddleware, sendReminder);

module.exports = router;
