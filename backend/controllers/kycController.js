const crypto = require("crypto");
const db = require("../db");
const KycProviderFactory = require("../services/kyc/KycProviderFactory");
const { compareNames } = require("../utils/nameMatcher");
const { recordAuditLog } = require("../utils/auditLog");
const notificationService = require("../services/notificationService");

const dbPromise = db.promise();

/**
 * Computes HMAC-SHA256 hash using server pepper for identity lookups
 * @param {string} value 
 * @returns {string} Hex hash string
 */
function computeKeyedHash(value) {
  if (!value) return null;
  const pepper = process.env.KYC_HASH_PEPPER || "default_dev_pepper_secret_1234567890";
  return crypto.createHmac("sha256", pepper).update(String(value).trim()).digest("hex");
}

/**
 * 1. Initiate Provider-Independent KYC Verification Session
 */
exports.initiateKycSession = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    // Check if user is already verified
    const [[existingKyc]] = await dbPromise.query(
      "SELECT status FROM user_kyc WHERE user_id = ?",
      [userId]
    );

    if (existingKyc && existingKyc.status === "VERIFIED") {
      return res.status(400).json({ message: "Your identity is already verified." });
    }

    // Generate 256-bit cryptographically secure single-use state token
    const stateToken = crypto.randomBytes(32).toString("hex");

    // Get active provider instance
    const provider = KycProviderFactory.getProvider();
    const providerName = provider.getProviderName();

    // Set 5-minute expiry window
    const connection = await dbPromise.getConnection();
    await connection.beginTransaction();

    try {
      // Invalidate any existing open sessions for this user
      await connection.query(
        "UPDATE kyc_verification_sessions SET status = 'EXPIRED' WHERE user_id = ? AND status = 'INITIATED'",
        [userId]
      );

      // Create new session record
      await connection.query(
        `INSERT INTO kyc_verification_sessions (user_id, state_token, provider, status, expires_at)
         VALUES (?, ?, ?, 'INITIATED', DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
        [userId, stateToken, providerName]
      );

      // Upsert user_kyc status to IN_PROGRESS
      await connection.query(
        `INSERT INTO user_kyc (user_id, aadhaar_number_masked, aadhaar_number_hash, verification_provider, status)
         VALUES (?, 'PENDING', 'PENDING', ?, 'IN_PROGRESS')
         ON DUPLICATE KEY UPDATE
           verification_provider = VALUES(verification_provider),
           status = IF(status = 'VERIFIED', 'VERIFIED', 'IN_PROGRESS')`,
        [userId, providerName]
      );

      await connection.commit();

      // Generate provider auth URL
      const callbackUrl = process.env.DIGILOCKER_REDIRECT_URI || `${req.protocol}://${req.get("host")}/api/profile/kyc/callback`;
      const { redirectUrl } = await provider.initiateVerification({
        userId,
        callbackUrl,
        stateToken
      });

      await recordAuditLog(dbPromise, {
        userId,
        actionType: "KYC_INITIATED",
        referenceType: "USER",
        referenceId: userId,
        details: { provider: providerName, stateToken: stateToken.substring(0, 8) + "..." }
      });

      return res.status(200).json({
        message: "KYC session initiated successfully.",
        provider: providerName,
        stateToken,
        redirectUrl
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Initiate KYC Session Error:", error.message);
    return res.status(500).json({ message: error.message || "Error initiating KYC verification session" });
  }
};

/**
 * 2. Process Provider Callback & Perform Data Minimization Verification
 */
exports.handleKycCallback = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { code, state, stateToken, error, error_description } = { ...req.query, ...req.body };
    const targetStateToken = stateToken || state;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (!targetStateToken) {
      return res.status(400).json({ message: "State token is required for callback verification." });
    }

    const connection = await dbPromise.getConnection();
    await connection.beginTransaction();

    try {
      // 1. Fetch & Validate Session (IDOR & Replay & Expiry Checks)
      const [[session]] = await connection.query(
        "SELECT session_id, user_id, provider, status, expires_at FROM kyc_verification_sessions WHERE state_token = ?",
        [targetStateToken]
      );

      if (!session) {
        await connection.rollback();
        return res.status(403).json({ message: "Invalid verification state token.", reasonCode: "INVALID_STATE" });
      }

      // IDOR Protection: Verify session belongs to authenticated user
      if (session.user_id !== userId) {
        await connection.rollback();
        return res.status(403).json({ message: "State token does not match authenticated user.", reasonCode: "INVALID_STATE" });
      }

      // Replay Protection: Single-use enforcement
      if (session.status !== "INITIATED") {
        await connection.rollback();
        return res.status(400).json({ message: "Verification state token has already been used.", reasonCode: "TOKEN_ALREADY_USED" });
      }

      // Expiry Check
      const now = new Date();
      if (new Date(session.expires_at) < now) {
        await connection.query("UPDATE kyc_verification_sessions SET status = 'EXPIRED', reason_code = 'OAUTH_EXPIRED' WHERE session_id = ?", [session.session_id]);
        await connection.commit();
        return res.status(400).json({ message: "Verification session has expired. Please try again.", reasonCode: "OAUTH_EXPIRED" });
      }

      // Replay Protection: Instantly mark session COMPLETED or FAILED
      const isUserCancellation = error === "access_denied" || !code;
      const finalSessionStatus = isUserCancellation ? "CANCELLED" : "COMPLETED";

      await connection.query(
        "UPDATE kyc_verification_sessions SET status = ?, reason_code = ? WHERE session_id = ?",
        [finalSessionStatus, isUserCancellation ? "USER_CANCELLED" : "CALLBACK_PROCESSED", session.session_id]
      );

      // Handle User Cancellation
      if (isUserCancellation) {
        // Reset status back to NOT_STARTED if currently IN_PROGRESS
        await connection.query(
          "UPDATE user_kyc SET status = IF(status = 'IN_PROGRESS', 'NOT_STARTED', status), reason_code = 'USER_CANCELLED' WHERE user_id = ?",
          [userId]
        );
        await connection.commit();
        return res.status(200).json({
          status: "NOT_STARTED",
          sessionStatus: "CANCELLED",
          reasonCode: "USER_CANCELLED",
          message: "Verification cancelled by user."
        });
      }

      // 2. Call Provider Adapter to Process Code
      const provider = KycProviderFactory.getProvider(session.provider);
      const callbackUrl = process.env.DIGILOCKER_REDIRECT_URI || `${req.protocol}://${req.get("host")}/api/profile/kyc/callback`;
      
      const providerResult = await provider.processCallback({
        code,
        stateToken: targetStateToken,
        callbackUrl,
        mockName: req.body.mockName || req.query.mockName
      });

      if (!providerResult.success) {
        await connection.query(
          "UPDATE user_kyc SET status = IF(status = 'IN_PROGRESS', 'NOT_STARTED', status), reason_code = ? WHERE user_id = ?",
          [providerResult.reasonCode || "PROVIDER_UNAVAILABLE", userId]
        );
        await connection.commit();
        return res.status(400).json({
          status: "NOT_STARTED",
          sessionStatus: "FAILED",
          reasonCode: providerResult.reasonCode || "PROVIDER_UNAVAILABLE",
          message: providerResult.errorDetails || "Verification provider error."
        });
      }

      // 3. Fetch Registered User Profile Name
      const [[user]] = await connection.query("SELECT name FROM users WHERE user_id = ?", [userId]);
      const profileName = user ? user.name : "";

      // 4. Run Conservative Name Matching Engine
      const nameMatchResult = compareNames(profileName, providerResult.verifiedName);

      // 5. Data Minimization: Masked Aadhaar & HMAC-SHA256 Hash
      const maskedAadhaar = providerResult.maskedAadhaar || "XXXX-XXXX-9999";
      const aadhaarHash = computeKeyedHash(providerResult.cleanAadhaar || maskedAadhaar);

      // Check Uniqueness of Aadhaar Hash across other users
      if (aadhaarHash) {
        const [[dupAadhaar]] = await connection.query(
          "SELECT user_id FROM user_kyc WHERE aadhaar_number_hash = ? AND user_id <> ?",
          [aadhaarHash, userId]
        );
        if (dupAadhaar) {
          await connection.query(
            `UPDATE user_kyc 
             SET status = 'REVIEW_REQUIRED', reason_code = 'DUPLICATE_IDENTITY_REVIEW_REQUIRED', rejection_reason = 'Duplicate Aadhaar registration attempt' 
             WHERE user_id = ?`,
            [userId]
          );
          await connection.query("UPDATE users SET verification_status = 'PENDING' WHERE user_id = ?", [userId]);
          await connection.commit();

          return res.status(200).json({
            status: "REVIEW_REQUIRED",
            reasonCode: "DUPLICATE_IDENTITY_REVIEW_REQUIRED",
            message: "Duplicate identity detected. Submission sent for Admin Review."
          });
        }
      }

      // 6. Branch on Name Match Result
      if (nameMatchResult.match) {
        // Clear Match (EXACT or TOKEN_SET) -> VERIFIED
        await connection.query(
          `UPDATE user_kyc 
           SET status = 'VERIFIED',
               verification_provider = ?,
               provider_reference_id = ?,
               aadhaar_number_masked = ?,
               aadhaar_number_hash = ?,
               reason_code = ?,
               rejection_reason = NULL,
               verified_by = NULL,
               verified_at = NOW()
           WHERE user_id = ?`,
          [
            session.provider,
            providerResult.providerReferenceId || null,
            maskedAadhaar,
            aadhaarHash,
            nameMatchResult.reasonCode,
            userId
          ]
        );

        await connection.query("UPDATE users SET verification_status = 'VERIFIED' WHERE user_id = ?", [userId]);

        const [[kycRecord]] = await connection.query("SELECT kyc_id FROM user_kyc WHERE user_id = ?", [userId]);
        const kycId = kycRecord ? kycRecord.kyc_id : 0;

        await connection.query(
          `INSERT INTO user_kyc_history (kyc_id, user_id, action_type, status, performed_by)
           VALUES (?, ?, 'VERIFIED', 'VERIFIED', ?)`,
          [kycId, userId, userId]
        );

        await connection.commit();

        await recordAuditLog(dbPromise, {
          userId,
          actionType: "KYC_VERIFIED",
          referenceType: "USER",
          referenceId: userId,
          details: { provider: session.provider, reasonCode: nameMatchResult.reasonCode }
        });

        await dbPromise.query(
          "INSERT INTO notifications (user_id, type, message) VALUES (?, 'KYC_STATUS', ?)",
          [userId, "Your identity verification has been successfully VERIFIED via DigiLocker! You can now join chit groups."]
        );

        return res.status(200).json({
          status: "VERIFIED",
          reasonCode: nameMatchResult.reasonCode,
          provider: session.provider,
          message: "Identity verification successful!"
        });
      } else {
        // Ambiguous or Mismatched Name -> REVIEW_REQUIRED (Routes to Admin Queue)
        await connection.query(
          `UPDATE user_kyc 
           SET status = 'REVIEW_REQUIRED',
               verification_provider = ?,
               provider_reference_id = ?,
               aadhaar_number_masked = ?,
               aadhaar_number_hash = ?,
               reason_code = ?,
               rejection_reason = ?
           WHERE user_id = ?`,
          [
            session.provider,
            providerResult.providerReferenceId || null,
            maskedAadhaar,
            aadhaarHash,
            nameMatchResult.reasonCode,
            `Name discrepancy: Profile name '${profileName}' vs e-KYC name '${providerResult.verifiedName}'`,
            userId
          ]
        );

        await connection.query("UPDATE users SET verification_status = 'PENDING' WHERE user_id = ?", [userId]);

        const [[kycRecord]] = await connection.query("SELECT kyc_id FROM user_kyc WHERE user_id = ?", [userId]);
        const kycId = kycRecord ? kycRecord.kyc_id : 0;

        await connection.query(
          `INSERT INTO user_kyc_history (kyc_id, user_id, action_type, status, rejection_reason, performed_by)
           VALUES (?, ?, 'REVIEW_REQUIRED', 'REVIEW_REQUIRED', ?, ?)`,
          [kycId, userId, nameMatchResult.reasonCode, userId]
        );

        await connection.commit();

        await recordAuditLog(dbPromise, {
          userId,
          actionType: "KYC_REVIEW_REQUIRED",
          referenceType: "USER",
          referenceId: userId,
          details: { profileName, verifiedName: providerResult.verifiedName, reasonCode: nameMatchResult.reasonCode }
        });

        await dbPromise.query(
          "INSERT INTO notifications (user_id, type, message) VALUES (?, 'KYC_STATUS', ?)",
          [userId, "Your identity verification is under Admin Review due to a name format discrepancy."]
        );

        return res.status(200).json({
          status: "REVIEW_REQUIRED",
          reasonCode: nameMatchResult.reasonCode,
          provider: session.provider,
          message: "Name verification requires Admin exception review."
        });
      }
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("KYC Callback Error:", error.message);
    return res.status(500).json({ message: "Error processing KYC callback verification" });
  }
};

/**
 * 3. Get Current User KYC Verification Status & History
 */
exports.getKycStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const [[userKyc]] = await dbPromise.query(
      `SELECT kyc_id, user_id, aadhaar_number_masked, pan_number_masked, verification_provider,
              status, reason_code, rejection_reason, verified_at, submitted_at, updated_at
       FROM user_kyc
       WHERE user_id = ?`,
      [userId]
    );

    const [history] = await dbPromise.query(
      `SELECT history_id, action_type, status, rejection_reason, performed_at
       FROM user_kyc_history
       WHERE user_id = ?
       ORDER BY performed_at DESC`,
      [userId]
    );

    return res.status(200).json({
      kyc: userKyc || { status: "NOT_STARTED", verification_provider: "NONE" },
      history: history || []
    });
  } catch (error) {
    console.error("Get KYC Status Error:", error.message);
    return res.status(500).json({ message: "Error fetching KYC status" });
  }
};
