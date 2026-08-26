const db = require("../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { recordAuditLog } = require("../utils/auditLog");
const notificationService = require("../services/notificationService");

const dbPromise = db.promise();

// Helper to calculate SHA-256 hash of tokens/OTPs
function hashToken(rawCredential) {
  return crypto.createHash("sha256").update(String(rawCredential).trim()).digest("hex");
}

// Password strength validator (Min 8 chars, at least 1 letter and 1 number)
function validatePasswordStrength(password) {
  if (!password || String(password).length < 8) {
    return "Password must contain at least 8 characters.";
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain at least one letter and one number.";
  }
  return null;
}

exports.register = async (req, res) => {
  const { name, phone, email, password, role } = req.body;

  try {
    const requestedRole = String(role || "MEMBER").toUpperCase();
    const [[adminCountRow]] = await dbPromise.query(
      "SELECT COUNT(*) AS admin_count FROM users WHERE role = 'ADMIN'"
    );
    const allowPublicAdminRegistration = process.env.ALLOW_PUBLIC_ADMIN_REGISTRATION === "true";
    const normalizedRole =
      requestedRole === "ADMIN" &&
      (allowPublicAdminRegistration || Number(adminCountRow.admin_count) === 0)
        ? "ADMIN"
        : "MEMBER";

    if (requestedRole === "ADMIN" && normalizedRole !== "ADMIN") {
      return res.status(400).json({
        message: "Admin registration is not allowed by policy. Admin accounts must be created by policy."
      });
    }

    if (!name || !phone || !email || !password) {
      return res.status(400).json({ message: "Name, phone, email and password are required" });
    }

    const strengthErr = validatePasswordStrength(password);
    if (strengthErr) {
      return res.status(400).json({ message: strengthErr });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const connection = await dbPromise.getConnection();
    await connection.beginTransaction();

    try {
      const [result] = await connection.query(
        "INSERT INTO users (name, phone, email, password_hash, role, token_version) VALUES (?, ?, ?, ?, ?, 0)",
        [name, phone, email, hashedPassword, normalizedRole]
      );
      
      const userId = result.insertId;

      await connection.query(
        "INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)",
        [userId]
      );

      await connection.commit();
      res.json({
        message: "User registered successfully",
        role: normalizedRole,
      });
    } catch (err) {
      await connection.rollback();
      console.log("MYSQL ERROR:", err);
      if (err.code === "ER_DUP_ENTRY") {
         return res.status(400).json({ message: "Phone or email already exists" });
      }
      return res.status(500).json({ message: err.sqlMessage || "Database error" });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.login = (req, res) => {
  const { phone, password } = req.body;

  const sql = "SELECT * FROM users WHERE phone = ?";

  db.query(sql, [phone], async (err, results) => {
    if (err) return res.status(500).json({ message: "Database error" });

    if (results.length === 0)
      return res.status(401).json({ message: "User not found" });

    const user = results[0];

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match)
      return res.status(401).json({ message: "Invalid password" });

    const userId = user.user_id || user.id;
    const normalizedRole = String(user.role || "").toUpperCase();
    const tokenVersion = Number(user.token_version || 0);

    const token = jwt.sign(
      { id: userId, role: normalizedRole, token_version: tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      message: "Login successful",
      token,
      role: normalizedRole,
      user_id: userId,
    });
  });
};

/**
 * 1. Request Password Reset (Supports Email & Phone)
 */
exports.requestPasswordReset = async (req, res) => {
  const { identifier } = req.body;
  const clientIp = req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';

  const genericResponse = {
    message: "If an account exists for this email/phone, password reset instructions have been sent.",
  };

  if (!identifier) {
    return res.status(400).json({ message: "Email or Phone number is required." });
  }

  try {
    const cleanId = String(identifier).trim();
    const isEmail = cleanId.includes("@");

    // Lookup user
    const [[user]] = await dbPromise.query(
      "SELECT user_id, name, phone, email FROM users WHERE phone = ? OR email = ?",
      [cleanId, cleanId]
    );

    if (!user) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`\n⚠️ [DEV NOTICE] Password reset requested for '${cleanId}', but NO matching user was found in database.`);
        console.log(`   Hint: Registered test accounts in DB are:`);
        console.log(`   - Phone: 9876543210 (Rahul Sharma)`);
        console.log(`   - Phone: 9876543211 (Priya Verma)`);
        console.log(`   - Phone: 9999999999 (Super Admin)`);
        console.log(`   - Email: rahul@gmail.com, priya@gmail.com, admin@chitfund.com\n`);
      }
      // Return generic response to prevent account enumeration
      return res.status(200).json(genericResponse);
    }

    const expiryMinutes = parseInt(process.env.RESET_EXPIRY_MINUTES, 10) || 15;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Invalidate prior active reset tokens for this user
    await dbPromise.query(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL",
      [user.user_id]
    );

    let rawToken = null;
    let rawOtp = null;

    if (isEmail) {
      // Email Flow: Cryptographically random hex token
      rawToken = crypto.randomBytes(32).toString("hex");
      const hashedToken = hashToken(rawToken);

      await dbPromise.query(
        `INSERT INTO password_reset_tokens (user_id, channel, token_hash, max_attempts, expires_at, created_from_ip)
         VALUES (?, 'EMAIL', ?, 5, ?, ?)`,
        [user.user_id, hashedToken, expiresAt, clientIp]
      );

      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

      await notificationService.sendPasswordResetLink({
        userId: user.user_id,
        email: user.email,
        token: rawToken,
        resetUrl,
        expiryMinutes,
      });
    } else {
      // Phone Flow: Cryptographically secure 6-digit numeric OTP
      rawOtp = crypto.randomInt(100000, 999999).toString();
      const hashedOtp = hashToken(rawOtp);

      await dbPromise.query(
        `INSERT INTO password_reset_tokens (user_id, channel, token_hash, max_attempts, expires_at, created_from_ip)
         VALUES (?, 'PHONE', ?, 5, ?, ?)`,
        [user.user_id, hashedOtp, expiresAt, clientIp]
      );

      await notificationService.sendPasswordResetOtp({
        userId: user.user_id,
        phone: user.phone,
        otp: rawOtp,
        expiryMinutes,
      });
    }

    await recordAuditLog(dbPromise, {
      userId: user.user_id,
      actionType: "PASSWORD_RESET_REQUESTED",
      referenceType: "USER",
      referenceId: user.user_id,
      details: { channel: isEmail ? "EMAIL" : "PHONE", ip: clientIp },
    });

    const responsePayload = { ...genericResponse };
    if (process.env.NODE_ENV !== 'production') {
      if (isEmail && rawToken) {
        responsePayload.dev_link = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${rawToken}`;
      } else if (!isEmail && rawOtp) {
        responsePayload.dev_otp = rawOtp;
      }
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("Password Reset Request Error:", error);
    return res.status(500).json({ message: "An error occurred while processing your request." });
  }
};

/**
 * 2. Verify Phone OTP
 */
exports.verifyResetOtp = async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ message: "Phone number and OTP code are required." });
  }

  try {
    const cleanPhone = String(phone).trim();
    const [[user]] = await dbPromise.query("SELECT user_id FROM users WHERE phone = ?", [cleanPhone]);

    if (!user) {
      return res.status(400).json({ message: "Invalid OTP code or request." });
    }

    const hashedOtp = hashToken(otp);

    // Fetch active reset token record for phone
    const [[resetRecord]] = await dbPromise.query(
      `SELECT * FROM password_reset_tokens 
       WHERE user_id = ? AND channel = 'PHONE' AND used_at IS NULL 
       ORDER BY created_at DESC LIMIT 1`,
      [user.user_id]
    );

    if (!resetRecord) {
      return res.status(400).json({ message: "No active password reset request found." });
    }

    // Check expiration
    if (new Date(resetRecord.expires_at) < new Date()) {
      await recordAuditLog(dbPromise, {
        userId: user.user_id,
        actionType: "PASSWORD_RESET_TOKEN_EXPIRED",
        referenceType: "USER",
        referenceId: user.user_id,
      });
      return res.status(400).json({ message: "OTP code has expired. Please request a new code." });
    }

    // Check maximum failed attempts
    if (resetRecord.attempt_count >= resetRecord.max_attempts) {
      await recordAuditLog(dbPromise, {
        userId: user.user_id,
        actionType: "PASSWORD_RESET_TOKEN_INVALIDATED",
        referenceType: "USER",
        referenceId: user.user_id,
        details: { reason: "Max attempt limit exceeded" },
      });
      return res.status(400).json({ message: "Maximum verification attempts exceeded. Please request a new OTP." });
    }

    // Compare Hash
    if (resetRecord.token_hash !== hashedOtp) {
      await dbPromise.query(
        "UPDATE password_reset_tokens SET attempt_count = attempt_count + 1 WHERE reset_id = ?",
        [resetRecord.reset_id]
      );
      await recordAuditLog(dbPromise, {
        userId: user.user_id,
        actionType: "OTP_VERIFICATION_FAILED",
        referenceType: "USER",
        referenceId: user.user_id,
        details: { attemptsLeft: resetRecord.max_attempts - (resetRecord.attempt_count + 1) },
      });
      return res.status(400).json({
        message: "Incorrect OTP code.",
        attemptsRemaining: resetRecord.max_attempts - (resetRecord.attempt_count + 1),
      });
    }

    // OTP Verified! Generate short-lived reset authorization token (15 mins)
    const resetAuthToken = jwt.sign(
      { userId: user.user_id, resetId: resetRecord.reset_id, purpose: "PASSWORD_RESET" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    await recordAuditLog(dbPromise, {
      userId: user.user_id,
      actionType: "OTP_VERIFICATION_SUCCESSFUL",
      referenceType: "USER",
      referenceId: user.user_id,
    });

    return res.status(200).json({
      message: "OTP verified successfully.",
      resetAuthToken,
    });
  } catch (error) {
    console.error("Verify OTP Error:", error);
    return res.status(500).json({ message: "Server error during OTP verification." });
  }
};

/**
 * 3. Submit New Password (via Email Token or Phone Reset Auth Token)
 */
exports.resetPassword = async (req, res) => {
  const { token, resetAuthToken, newPassword } = req.body;

  const strengthErr = validatePasswordStrength(newPassword);
  if (strengthErr) {
    return res.status(400).json({ message: strengthErr });
  }

  const connection = await dbPromise.getConnection();
  await connection.beginTransaction();

  try {
    let userId = null;
    let resetId = null;

    if (token) {
      // Email Token Reset Flow
      const hashedToken = hashToken(token);
      const [[resetRecord]] = await connection.query(
        `SELECT * FROM password_reset_tokens WHERE token_hash = ? AND channel = 'EMAIL' AND used_at IS NULL FOR UPDATE`,
        [hashedToken]
      );

      if (!resetRecord) {
        await connection.rollback();
        return res.status(400).json({ message: "Invalid or already used password reset link." });
      }

      if (new Date(resetRecord.expires_at) < new Date()) {
        await connection.rollback();
        return res.status(400).json({ message: "Password reset link has expired. Please request a new link." });
      }

      userId = resetRecord.user_id;
      resetId = resetRecord.reset_id;
    } else if (resetAuthToken) {
      // Phone OTP Verified Flow
      let decoded;
      try {
        decoded = jwt.verify(resetAuthToken, process.env.JWT_SECRET);
      } catch (err) {
        await connection.rollback();
        return res.status(400).json({ message: "Reset authorization token has expired or is invalid." });
      }

      if (decoded.purpose !== "PASSWORD_RESET") {
        await connection.rollback();
        return res.status(400).json({ message: "Invalid reset token." });
      }

      userId = decoded.userId;
      resetId = decoded.resetId;

      const [[resetRecord]] = await connection.query(
        `SELECT * FROM password_reset_tokens WHERE reset_id = ? AND used_at IS NULL FOR UPDATE`,
        [resetId]
      );

      if (!resetRecord) {
        await connection.rollback();
        return res.status(400).json({ message: "Reset token already used." });
      }
    } else {
      await connection.rollback();
      return res.status(400).json({ message: "Reset token or authorization is required." });
    }

    // Fetch user
    const [[user]] = await connection.query("SELECT * FROM users WHERE user_id = ?", [userId]);
    if (!user) {
      await connection.rollback();
      return res.status(404).json({ message: "User account not found." });
    }

    // Hash new password using bcrypt
    const newHashedPassword = await bcrypt.hash(newPassword, 10);

    // Atomically mark token as used, increment token_version, update password_hash & password_changed_at
    await connection.query(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE reset_id = ?",
      [resetId]
    );

    await connection.query(
      `UPDATE users 
       SET password_hash = ?, token_version = token_version + 1, password_changed_at = NOW() 
       WHERE user_id = ?`,
      [newHashedPassword, userId]
    );

    await connection.commit();

    // Trigger security alert notification
    await notificationService.sendPasswordChangeSecurityAlert({
      userId: user.user_id,
      name: user.name,
      phone: user.phone,
      email: user.email,
    });

    await recordAuditLog(dbPromise, {
      userId: user.user_id,
      actionType: "PASSWORD_RESET_SUCCESSFUL",
      referenceType: "USER",
      referenceId: user.user_id,
    });

    return res.status(200).json({
      message: "Password reset successful! You can now log in with your new password.",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Reset Password Error:", error);
    return res.status(500).json({ message: "Server error during password reset." });
  } finally {
    connection.release();
  }
};

/**
 * 4. Admin-Assisted Reset (Triggers member's secure reset flow)
 */
exports.adminInitiatedReset = async (req, res) => {
  const adminId = req.user?.id;
  const { memberId } = req.body;

  if (!adminId || req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Only admins can initiate password resets for members." });
  }

  if (!memberId) {
    return res.status(400).json({ message: "Member ID is required." });
  }

  try {
    const [[member]] = await dbPromise.query(
      "SELECT user_id, name, phone, email FROM users WHERE user_id = ?",
      [memberId]
    );

    if (!member) {
      return res.status(404).json({ message: "Member not found." });
    }

    const expiryMinutes = parseInt(process.env.RESET_EXPIRY_MINUTES, 10) || 15;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
    const clientIp = req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';

    // Invalidate existing reset tokens for member
    await dbPromise.query(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL",
      [member.user_id]
    );

    // Generate secure OTP for SMS or Link for Email
    const rawOtp = crypto.randomInt(100000, 999999).toString();
    const hashedOtp = hashToken(rawOtp);

    await dbPromise.query(
      `INSERT INTO password_reset_tokens (user_id, channel, token_hash, max_attempts, expires_at, created_from_ip)
       VALUES (?, 'PHONE', ?, 5, ?, ?)`,
      [member.user_id, hashedOtp, expiresAt, clientIp]
    );

    await notificationService.sendPasswordResetOtp({
      userId: member.user_id,
      phone: member.phone,
      otp: rawOtp,
      expiryMinutes,
    });

    await recordAuditLog(dbPromise, {
      userId: adminId,
      actionType: "ADMIN_INITIATED_PASSWORD_RESET",
      referenceType: "USER",
      referenceId: member.user_id,
      details: { adminId, targetMemberId: member.user_id },
    });

    return res.status(200).json({
      message: `Password reset triggered successfully for member ${member.name}. A verification code has been sent directly to their phone/email.`,
    });
  } catch (error) {
    console.error("Admin Initiated Reset Error:", error);
    return res.status(500).json({ message: "Error triggering member password reset." });
  }
};

exports.submitKyc = async (req, res) => {
  const userId = req.user?.id;
  const { aadhar_number, pan_number } = req.body;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!aadhar_number || !pan_number) {
    return res.status(400).json({ message: "Aadhar and PAN are required for KYC" });
  }

  const normalizedAadhar = String(aadhar_number).replace(/\s+/g, "");
  const normalizedPan = String(pan_number).trim().toUpperCase();

  if (!/^\d{12}$/.test(normalizedAadhar)) {
    return res.status(400).json({ message: "Aadhar number must contain exactly 12 digits" });
  }

  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(normalizedPan)) {
    return res.status(400).json({ message: "PAN number format is invalid" });
  }

  try {
    const [result] = await dbPromise.query(
      "UPDATE users SET verification_status = 'VERIFIED' WHERE user_id = ?",
      [userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "KYC verified successfully. You can now join chit groups." });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Database error during KYC update" });
  }
};
