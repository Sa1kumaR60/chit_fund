const db = require("../db");

const dbPromise = db.promise();

const getNotifications = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const [notifications] = await dbPromise.query(
      `
        SELECT * FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC
      `,
      [userId]
    );

    return res.status(200).json(notifications);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const markAsRead = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { notificationId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await dbPromise.query(
      "UPDATE notifications SET is_read = TRUE WHERE notification_id = ? AND user_id = ?",
      [notificationId, userId]
    );

    return res.status(200).json({ message: "Marked as read" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const sendReminder = async (req, res) => {
  try {
    const adminId = req.user?.id;
    const { memberId } = req.params;
    const { chitId } = req.body;

    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Only admins can send manual reminders" });
    }

    // Verify admin owns the chit
    const [[chit]] = await dbPromise.query("SELECT * FROM chits WHERE chit_id = ? AND admin_id = ?", [chitId, adminId]);
    if (!chit) {
      return res.status(403).json({ message: "You do not manage this chit group" });
    }

    const message = `Admin reminder: Please clear your pending dues for Chit Group #${chitId} - ${chit.group_name} immediately to avoid further penalties.`;

    await dbPromise.query(
      "INSERT INTO notifications (user_id, type, message) VALUES (?, 'REMINDER', ?)",
      [memberId, message]
    );

    return res.status(200).json({ message: "Reminder sent successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  sendReminder,
};
