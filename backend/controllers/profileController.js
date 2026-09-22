const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const db = require("../db");
const { encryptText, maskAccountNumber } = require("../services/encryptionService");
const { saveAvatar, deleteAvatar, getAvatarUrl, savePrivateKycDocument } = require("../services/storageService");
const { recordAuditLog } = require("../utils/auditLog");

const dbPromise = db.promise();

// Helper to calculate SHA-256 hash
function sha256Hash(text) {
  return crypto.createHash("sha256").update(String(text).trim().toUpperCase()).digest("hex");
}

// Mask PAN: ABCDE1234F -> ABCDE****F
function maskPan(pan) {
  const clean = String(pan).trim().toUpperCase();
  if (clean.length < 10) return "ABCDE****F";
  return clean.slice(0, 5) + "****" + clean.slice(9);
}

// Mask Aadhaar: 123456789012 -> XXXX-XXXX-9012
function maskAadhaar(aadhaar) {
  const clean = String(aadhaar).replace(/\D/g, "");
  if (clean.length < 12) return "XXXX-XXXX-1234";
  return "XXXX-XXXX-" + clean.slice(8);
}

/**
 * 1. Get Logged-in Profile Overview
 */
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const [[user]] = await dbPromise.query(
      `SELECT user_id, name, phone, email, role, verification_status, merit_score, 
              avatar_key, account_status, is_email_verified, is_phone_verified, created_at 
       FROM users WHERE user_id = ?`,
      [userId]
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    const [[kyc]] = await dbPromise.query(
      `SELECT status, pan_number_masked, aadhaar_number_masked, rejection_reason, submitted_at, verified_at 
       FROM user_kyc WHERE user_id = ?`,
      [userId]
    );

    const [[wallet]] = await dbPromise.query(
      "SELECT balance FROM wallets WHERE user_id = ?",
      [userId]
    );

    const avatarUrl = getAvatarUrl(user.avatar_key);

    return res.status(200).json({
      user: {
        ...user,
        avatarUrl,
      },
      kyc: kyc || { status: user.verification_status },
      wallet: wallet || { balance: 0.0 },
    });
  } catch (error) {
    console.error("Get Profile Error:", error);
    return res.status(500).json({ message: "Error fetching profile" });
  }
};

/**
 * 2. Update Editable Profile Information (Name)
 */
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { name } = req.body;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Name cannot be empty." });
    }

    await dbPromise.query(
      "UPDATE users SET name = ? WHERE user_id = ?",
      [name.trim(), userId]
    );

    await recordAuditLog(dbPromise, {
      userId,
      actionType: "PROFILE_UPDATED",
      referenceType: "USER",
      referenceId: userId,
      details: { updatedFields: ["name"] },
    });

    return res.status(200).json({ message: "Profile updated successfully" });
  } catch (error) {
    console.error("Update Profile Error:", error);
    return res.status(500).json({ message: "Error updating profile" });
  }
};

/**
 * 2b. Upload & Process Profile Avatar Photo (512x512 WebP Cover Crop)
 */
exports.uploadAvatar = async (req, res) => {
  let savedNewKey = null;
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: "No image file uploaded." });
    }

    // 1. Strict MIME type check
    const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ message: "Invalid image format. Only JPEG, PNG, and WEBP files are allowed." });
    }

    // 2. Multi-layer image validation & 512x512 cover crop via Sharp
    let processedBuffer;
    try {
      processedBuffer = await sharp(req.file.buffer)
        .resize(512, 512, { fit: "cover", position: "center" })
        .toFormat("webp", { quality: 85 })
        .toBuffer();
    } catch (sharpErr) {
      console.error("Sharp Image Processing Error:", sharpErr);
      return res.status(400).json({ message: "Corrupted or invalid image file." });
    }

    // 3. Save new image file to disk via StorageService
    savedNewKey = saveAvatar(processedBuffer, userId);

    // 4. Fetch current avatar_key from DB
    const [[currentUser]] = await dbPromise.query(
      "SELECT avatar_key FROM users WHERE user_id = ?",
      [userId]
    );
    const oldAvatarKey = currentUser?.avatar_key;

    // 5. Update DB to point to new avatar_key
    await dbPromise.query(
      "UPDATE users SET avatar_key = ? WHERE user_id = ?",
      [savedNewKey, userId]
    );

    // 6. DB Update Succeeded -> Clean up old avatar image file
    if (oldAvatarKey) {
      deleteAvatar(oldAvatarKey);
    }

    await recordAuditLog(dbPromise, {
      userId,
      actionType: "AVATAR_UPDATED",
      referenceType: "USER",
      referenceId: userId,
      details: { avatar_key: savedNewKey },
    });

    const fullAvatarUrl = getAvatarUrl(savedNewKey);

    return res.status(200).json({
      message: "Profile photo updated successfully",
      avatarUrl: fullAvatarUrl,
    });
  } catch (error) {
    console.error("Upload Avatar Error:", error);

    // DB Update Failed -> Delete newly written image file to rollback
    if (savedNewKey) {
      deleteAvatar(savedNewKey);
    }

    return res.status(500).json({ message: error.message || "Error processing avatar upload" });
  }
};

/**
 * 2c. Remove Profile Avatar Photo
 */
exports.deleteAvatar = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    // 1. Fetch current avatar_key
    const [[currentUser]] = await dbPromise.query(
      "SELECT avatar_key FROM users WHERE user_id = ?",
      [userId]
    );
    const currentAvatarKey = currentUser?.avatar_key;

    // 2. Clear DB reference
    await dbPromise.query(
      "UPDATE users SET avatar_key = NULL WHERE user_id = ?",
      [userId]
    );

    // 3. Clean up physical file (safely ignored if unlinking fails)
    if (currentAvatarKey) {
      deleteAvatar(currentAvatarKey);
    }

    await recordAuditLog(dbPromise, {
      userId,
      actionType: "AVATAR_DELETED",
      referenceType: "USER",
      referenceId: userId,
      details: { deletedKey: currentAvatarKey },
    });

    return res.status(200).json({
      message: "Profile photo removed successfully",
      avatarUrl: null,
    });
  } catch (error) {
    console.error("Delete Avatar Error:", error);
    return res.status(500).json({ message: "Error deleting profile photo" });
  }
};

/**
 * 3. Submit Member KYC Credentials & Document Proof
 */
exports.submitKyc = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { pan_number, aadhaar_number, id_document_base64, document_name } = req.body;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (!pan_number || !aadhaar_number) {
      return res.status(400).json({ message: "PAN number and Aadhaar number are required." });
    }

    const cleanPan = String(pan_number).trim().toUpperCase();
    const cleanAadhaar = String(aadhaar_number).replace(/\D/g, "");

    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(cleanPan)) {
      return res.status(400).json({ message: "Invalid PAN number format (e.g. ABCDE1234F)." });
    }
    if (!/^\d{12}$/.test(cleanAadhaar)) {
      return res.status(400).json({ message: "Aadhaar number must contain exactly 12 digits." });
    }

    const panHash = sha256Hash(cleanPan);
    const aadhaarHash = sha256Hash(cleanAadhaar);

    // Check uniqueness across other users
    const [[dupPan]] = await dbPromise.query(
      "SELECT user_id FROM user_kyc WHERE pan_number_hash = ? AND user_id <> ?",
      [panHash, userId]
    );
    if (dupPan) return res.status(400).json({ message: "This PAN number is already registered to another account." });

    const [[dupAadhaar]] = await dbPromise.query(
      "SELECT user_id FROM user_kyc WHERE aadhaar_number_hash = ? AND user_id <> ?",
      [aadhaarHash, userId]
    );
    if (dupAadhaar) return res.status(400).json({ message: "This Aadhaar number is already registered to another account." });

    // Handle document storage
    let docPath = "storage/private_kyc_docs/default-placeholder.pdf";
    if (id_document_base64) {
      const buffer = Buffer.from(id_document_base64.split(",")[1] || id_document_base64, "base64");
      docPath = savePrivateKycDocument(buffer, document_name || "document.pdf");
    }

    const maskedPan = maskPan(cleanPan);
    const maskedAadhaar = maskAadhaar(cleanAadhaar);

    const connection = await dbPromise.getConnection();
    await connection.beginTransaction();

    try {
      // Upsert user_kyc
      const [kycRes] = await connection.query(
        `INSERT INTO user_kyc (user_id, pan_number_masked, pan_number_hash, aadhaar_number_masked, aadhaar_number_hash, id_document_path, status)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
         ON DUPLICATE KEY UPDATE 
           pan_number_masked = VALUES(pan_number_masked),
           pan_number_hash = VALUES(pan_number_hash),
           aadhaar_number_masked = VALUES(aadhaar_number_masked),
           aadhaar_number_hash = VALUES(aadhaar_number_hash),
           id_document_path = VALUES(id_document_path),
           status = 'PENDING',
           rejection_reason = NULL,
           submitted_at = CURRENT_TIMESTAMP`,
        [userId, maskedPan, panHash, maskedAadhaar, aadhaarHash, docPath]
      );

      const [[currentKyc]] = await connection.query("SELECT kyc_id FROM user_kyc WHERE user_id = ?", [userId]);
      const kycId = currentKyc.kyc_id;

      // Update user verification_status to PENDING
      await connection.query("UPDATE users SET verification_status = 'PENDING' WHERE user_id = ?", [userId]);

      // Record immutable KYC history entry
      await connection.query(
        `INSERT INTO user_kyc_history (kyc_id, user_id, action_type, status, performed_by)
         VALUES (?, ?, 'SUBMITTED', 'PENDING', ?)`,
        [kycId, userId, userId]
      );

      await connection.commit();

      await recordAuditLog(dbPromise, {
        userId,
        actionType: "KYC_SUBMITTED",
        referenceType: "USER",
        referenceId: userId,
        details: { maskedPan, maskedAadhaar },
      });

      return res.status(200).json({ message: "KYC documents submitted successfully for Admin review." });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Submit KYC Error:", error);
    return res.status(500).json({ message: error.message || "Error submitting KYC" });
  }
};

/**
 * 4. Get Current KYC Details & History Timeline
 */
exports.getKycDetails = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const [[kyc]] = await dbPromise.query(
      `SELECT kyc_id, user_id, pan_number_masked, aadhaar_number_masked, status, rejection_reason, submitted_at, verified_at 
       FROM user_kyc WHERE user_id = ?`,
      [userId]
    );

    if (!kyc) {
      return res.status(200).json({ kyc: null, history: [] });
    }

    const [history] = await dbPromise.query(
      `SELECT h.*, u.name AS actor_name 
       FROM user_kyc_history h JOIN users u ON u.user_id = h.performed_by 
       WHERE h.kyc_id = ? ORDER BY h.performed_at DESC`,
      [kyc.kyc_id]
    );

    return res.status(200).json({ kyc, history });
  } catch (error) {
    console.error("Get KYC Details Error:", error);
    return res.status(500).json({ message: "Error fetching KYC details" });
  }
};

/**
 * 5. Private Authorized Endpoint to Stream KYC Document
 */
exports.streamPrivateKycDocument = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { kycId } = req.params;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const [[kycRecord]] = await dbPromise.query(
      "SELECT kyc_id, user_id, id_document_path FROM user_kyc WHERE kyc_id = ?",
      [kycId]
    );

    if (!kycRecord) return res.status(404).json({ message: "KYC document record not found" });

    // Enforce Authorization: Only document owner or Admin can stream file
    if (req.user.role !== "ADMIN" && Number(userId) !== Number(kycRecord.user_id)) {
      return res.status(403).json({ message: "Forbidden: You do not have permission to view this document." });
    }

    const filePath = kycRecord.id_document_path;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found on storage server" });
    }

    res.setHeader("Cache-Control", "private, no-store");
    return res.sendFile(path.resolve(filePath));
  } catch (error) {
    console.error("Stream Document Error:", error);
    return res.status(500).json({ message: "Error streaming document" });
  }
};

/**
 * 6. Get & Update Notification Preferences
 */
exports.getNotificationPreferences = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    let [[prefs]] = await dbPromise.query(
      "SELECT * FROM user_notification_preferences WHERE user_id = ?",
      [userId]
    );

    if (!prefs) {
      await dbPromise.query(
        "INSERT INTO user_notification_preferences (user_id) VALUES (?)",
        [userId]
      );
      [[prefs]] = await dbPromise.query(
        "SELECT * FROM user_notification_preferences WHERE user_id = ?",
        [userId]
      );
    }

    return res.status(200).json(prefs);
  } catch (error) {
    return res.status(500).json({ message: "Error fetching notification preferences" });
  }
};

exports.updateNotificationPreferences = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { in_app_enabled, email_enabled, sms_enabled, push_enabled } = req.body;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    await dbPromise.query(
      `INSERT INTO user_notification_preferences (user_id, in_app_enabled, email_enabled, sms_enabled, push_enabled)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         in_app_enabled = VALUES(in_app_enabled),
         email_enabled = VALUES(email_enabled),
         sms_enabled = VALUES(sms_enabled),
         push_enabled = VALUES(push_enabled)`,
      [userId, in_app_enabled ? 1 : 0, email_enabled ? 1 : 0, sms_enabled ? 1 : 0, push_enabled ? 1 : 0]
    );

    return res.status(200).json({ message: "Notification preferences updated successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Error updating notification preferences" });
  }
};

/**
 * 7. Admin Designated Settlement Account Endpoints
 */
exports.getAdminSettlementAccount = async (req, res) => {
  try {
    const adminId = req.user?.id;
    if (!adminId || req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied. Admin only." });
    }

    const [[acc]] = await dbPromise.query(
      `SELECT account_id, admin_id, bank_name, account_holder_name, account_number_masked, ifsc_code, upi_id 
       FROM admin_settlement_accounts WHERE admin_id = ?`,
      [adminId]
    );

    return res.status(200).json(acc || null);
  } catch (error) {
    return res.status(500).json({ message: "Error fetching settlement account" });
  }
};

exports.updateAdminSettlementAccount = async (req, res) => {
  try {
    const adminId = req.user?.id;
    const { bank_name, account_holder_name, account_number, ifsc_code, upi_id } = req.body;

    if (!adminId || req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied. Admin only." });
    }

    if (!bank_name || !account_holder_name || !account_number || !ifsc_code) {
      return res.status(400).json({ message: "Bank name, account holder, account number, and IFSC code are required." });
    }

    const encryptedNo = encryptText(account_number);
    const maskedNo = maskAccountNumber(account_number);

    await dbPromise.query(
      `INSERT INTO admin_settlement_accounts (admin_id, bank_name, account_holder_name, account_number_encrypted, account_number_masked, ifsc_code, upi_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         bank_name = VALUES(bank_name),
         account_holder_name = VALUES(account_holder_name),
         account_number_encrypted = VALUES(account_number_encrypted),
         account_number_masked = VALUES(account_number_masked),
         ifsc_code = VALUES(ifsc_code),
         upi_id = VALUES(upi_id)`,
      [adminId, bank_name.trim(), account_holder_name.trim(), encryptedNo, maskedNo, ifsc_code.trim(), upi_id ? upi_id.trim() : null]
    );

    await recordAuditLog(dbPromise, {
      userId: adminId,
      actionType: "SETTLEMENT_ACCOUNT_UPDATED",
      referenceType: "USER",
      referenceId: adminId,
      details: { bank_name, maskedNo },
    });

    return res.status(200).json({ message: "Settlement account updated successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Error updating settlement account" });
  }
};

/**
 * 8. Admin Global Chit Defaults
 */
exports.getAdminChitDefaults = async (req, res) => {
  try {
    const adminId = req.user?.id;
    if (!adminId || req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied." });
    }

    const [[defaults]] = await dbPromise.query(
      "SELECT * FROM admin_chit_defaults WHERE admin_id = ?",
      [adminId]
    );

    return res.status(200).json(defaults || {
      auto_start_preference: 0,
      admin_approval_required: 1,
      allow_member_leave_before_start: 1,
      default_grace_period_days: 5,
      default_late_fee_rate: 0.02,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching chit defaults" });
  }
};

exports.updateAdminChitDefaults = async (req, res) => {
  try {
    const adminId = req.user?.id;
    const { auto_start_preference, admin_approval_required, allow_member_leave_before_start, default_grace_period_days, default_late_fee_rate } = req.body;

    if (!adminId || req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied." });
    }

    await dbPromise.query(
      `INSERT INTO admin_chit_defaults (admin_id, auto_start_preference, admin_approval_required, allow_member_leave_before_start, default_grace_period_days, default_late_fee_rate)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         auto_start_preference = VALUES(auto_start_preference),
         admin_approval_required = VALUES(admin_approval_required),
         allow_member_leave_before_start = VALUES(allow_member_leave_before_start),
         default_grace_period_days = VALUES(default_grace_period_days),
         default_late_fee_rate = VALUES(default_late_fee_rate)`,
      [adminId, auto_start_preference ? 1 : 0, admin_approval_required ? 1 : 0, allow_member_leave_before_start ? 1 : 0, default_grace_period_days || 5, default_late_fee_rate || 0.02]
    );

    return res.status(200).json({ message: "Chit defaults updated successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Error updating chit defaults" });
  }
};

/**
 * 9. Active Sessions Management
 */
exports.getActiveSessions = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const [sessions] = await dbPromise.query(
      `SELECT session_id, device_info, ip_address, last_active_at, created_at,
              (session_id = ?) AS is_current
       FROM user_sessions WHERE user_id = ? AND is_revoked = 0 ORDER BY last_active_at DESC`,
      [req.user.session_id || 0, userId]
    );

    return res.status(200).json(sessions);
  } catch (error) {
    return res.status(500).json({ message: "Error fetching sessions" });
  }
};

exports.logoutSession = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { sessionId } = req.body;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    await dbPromise.query(
      "UPDATE user_sessions SET is_revoked = 1 WHERE session_id = ? AND user_id = ?",
      [sessionId, userId]
    );

    return res.status(200).json({ message: "Session logged out successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Error logging out session" });
  }
};

exports.logoutOtherDevices = async (req, res) => {
  try {
    const userId = req.user?.id;
    const currentSessionId = req.user?.session_id;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    await dbPromise.query(
      "UPDATE user_sessions SET is_revoked = 1 WHERE user_id = ? AND session_id <> ?",
      [userId, currentSessionId || 0]
    );

    return res.status(200).json({ message: "Logged out from all other devices successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Error logging out other devices" });
  }
};

/**
 * 10. Account Deactivation with Safety Protections
 */
exports.deactivateAccount = async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const { reason } = req.body;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    if (role === "MEMBER") {
      // Check active chits for member
      const [[activeMembership]] = await dbPromise.query(
        `SELECT cm.chit_member_id FROM chit_members cm 
         JOIN chits c ON c.chit_id = cm.chit_id
         WHERE cm.member_id = ? AND c.status IN ('WAITING_MEMBERS', 'READY_TO_START', 'ACTIVE', 'AUCTION_RUNNING', 'PAYMENT_COLLECTION') LIMIT 1`,
        [userId]
      );

      if (activeMembership) {
        return res.status(400).json({
          message: "Cannot deactivate account while participating in active chit groups. Please complete your obligations first.",
        });
      }
    } else if (role === "ADMIN") {
      // Check active chits managed by Admin
      const [[activeChit]] = await dbPromise.query(
        `SELECT chit_id FROM chits WHERE admin_id = ? 
         AND status IN ('WAITING_MEMBERS', 'READY_TO_START', 'ACTIVE', 'AUCTION_RUNNING', 'PAYMENT_COLLECTION') LIMIT 1`,
        [userId]
      );

      if (activeChit) {
        return res.status(400).json({
          message: "Cannot deactivate Admin account while managing active chit groups. Please transfer or close active chits first.",
        });
      }
    }

    const connection = await dbPromise.getConnection();
    await connection.beginTransaction();

    try {
      await connection.query(
        `UPDATE users 
         SET account_status = 'DEACTIVATED', deactivated_at = NOW(), deactivation_reason = ?, token_version = token_version + 1 
         WHERE user_id = ?`,
        [reason || "User requested deactivation", userId]
      );

      await connection.query(
        "UPDATE user_sessions SET is_revoked = 1 WHERE user_id = ?",
        [userId]
      );

      await connection.commit();

      await recordAuditLog(dbPromise, {
        userId,
        actionType: "ACCOUNT_DEACTIVATED",
        referenceType: "USER",
        referenceId: userId,
        details: { reason },
      });

      return res.status(200).json({ message: "Account deactivated successfully." });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Deactivate Error:", error);
    return res.status(500).json({ message: error.message || "Error deactivating account" });
  }
};
