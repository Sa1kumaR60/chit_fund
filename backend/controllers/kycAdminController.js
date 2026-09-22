const db = require("../db");
const { recordAuditLog } = require("../utils/auditLog");
const notificationService = require("../services/notificationService");

const dbPromise = db.promise();

/**
 * Get Pending KYC Queue for Admin Review
 */
exports.getPendingKycQueue = async (req, res) => {
  try {
    const adminId = req.user?.id;
    if (!adminId || req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied. Admin only." });
    }

    const [rows] = await dbPromise.query(
      `SELECT k.kyc_id, k.user_id, k.pan_number_masked, k.aadhaar_number_masked, k.verification_provider, k.reason_code, k.rejection_reason, k.status, k.submitted_at,
              u.name, u.phone, u.email
       FROM user_kyc k
       JOIN users u ON u.user_id = k.user_id
       WHERE k.status IN ('PENDING', 'REVIEW_REQUIRED')
       ORDER BY k.submitted_at ASC`
    );

    return res.status(200).json(rows);
  } catch (error) {
    console.error("Get KYC Queue Error:", error);
    return res.status(500).json({ message: "Error fetching KYC queue" });
  }
};

/**
 * Admin Review (Approve / Reject) Member KYC Submission
 */
exports.reviewMemberKyc = async (req, res) => {
  try {
    const adminId = req.user?.id;
    const { kycId, decision, rejectionReason } = req.body;

    if (!adminId || req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied. Admin only." });
    }

    if (!kycId || !["VERIFIED", "REJECTED"].includes(decision)) {
      return res.status(400).json({ message: "kycId and decision ('VERIFIED' or 'REJECTED') are required." });
    }

    if (decision === "REJECTED" && (!rejectionReason || !rejectionReason.trim())) {
      return res.status(400).json({ message: "Rejection reason is mandatory when rejecting KYC." });
    }

    const [[kycRecord]] = await dbPromise.query(
      "SELECT kyc_id, user_id FROM user_kyc WHERE kyc_id = ?",
      [kycId]
    );

    if (!kycRecord) {
      return res.status(404).json({ message: "KYC record not found." });
    }

    const targetUserId = kycRecord.user_id;
    const connection = await dbPromise.getConnection();
    await connection.beginTransaction();

    try {
      await connection.query(
        `UPDATE user_kyc 
         SET status = ?, rejection_reason = ?, verified_by = ?, verified_at = NOW() 
         WHERE kyc_id = ?`,
        [decision, decision === "REJECTED" ? rejectionReason.trim() : null, adminId, kycId]
      );

      await connection.query(
        "UPDATE users SET verification_status = ? WHERE user_id = ?",
        [decision, targetUserId]
      );

      // Record in user_kyc_history timeline
      await connection.query(
        `INSERT INTO user_kyc_history (kyc_id, user_id, action_type, status, rejection_reason, performed_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [kycId, targetUserId, decision === "VERIFIED" ? "VERIFIED" : "REJECTED", decision, decision === "REJECTED" ? rejectionReason.trim() : null, adminId]
      );

      await connection.commit();

      const alertMsg = decision === "VERIFIED"
        ? "Your identity KYC verification has been APPROVED by Admin! You can now join chit groups."
        : `Your identity KYC submission was REJECTED: ${rejectionReason.trim()}`;

      await dbPromise.query(
        "INSERT INTO notifications (user_id, type, message) VALUES (?, 'KYC_STATUS', ?)",
        [targetUserId, alertMsg]
      );

      await recordAuditLog(dbPromise, {
        userId: adminId,
        actionType: decision === "VERIFIED" ? "KYC_VERIFIED" : "KYC_REJECTED",
        referenceType: "USER",
        referenceId: targetUserId,
        details: { decision, rejectionReason },
      });

      return res.status(200).json({
        message: `KYC submission ${decision.toLowerCase()} successfully.`,
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Review KYC Error:", error);
    return res.status(500).json({ message: "Error processing KYC review" });
  }
};
