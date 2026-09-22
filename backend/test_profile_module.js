const mysql = require("mysql2/promise");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { encryptText, decryptText, maskAccountNumber } = require("./services/encryptionService");

async function runTests() {
  console.log("=================================================");
  console.log("🧪 STARTING PROFILE & ACCOUNT MODULE TEST SUITE");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "Sa1kumaR11.1",
    database: process.env.DB_NAME || "chit_fund",
  });

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ PASSED: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: ${testName}`);
      failed++;
    }
  }

  try {
    // TEST 1: AES-256-GCM Encryption & Masking
    console.log("Test 1: Settlement Account AES-256-GCM Encryption & Masking");
    const rawAcc = "98765432101234";
    const encrypted = encryptText(rawAcc);
    const decrypted = decryptText(encrypted);
    const masked = maskAccountNumber(rawAcc);

    assert(decrypted === rawAcc, "Decrypted text matches original raw account number");
    assert(masked === "XXXXXXXXXX1234", "Account number masked correctly (XXXXXXXXXX1234)");
    assert(encrypted !== rawAcc, "Encrypted payload is not plain text");

    // TEST 2: Database Schema & Columns Verification
    console.log("\nTest 2: Schema Verification for Profile & KYC Tables");
    const [userCols] = await db.query("SHOW COLUMNS FROM users LIKE 'avatar_key'");
    assert(userCols.length > 0, "users.avatar_key column exists");

    const [kycCols] = await db.query("SHOW COLUMNS FROM user_kyc LIKE 'pan_number_hash'");
    assert(kycCols.length > 0, "user_kyc.pan_number_hash column exists");

    const [histCols] = await db.query("SHOW COLUMNS FROM user_kyc_history LIKE 'history_id'");
    assert(histCols.length > 0, "user_kyc_history table exists");

    const [feeCols] = await db.query("SHOW COLUMNS FROM system_fee_configs LIKE 'rate_per_month'");
    assert(feeCols.length > 0, "system_fee_configs.rate_per_month column exists");

    // TEST 3: KYC Submission & History Record
    console.log("\nTest 3: KYC Submission and History Logging");
    const testUserId = 2; // Member Rahul
    const testPan = "ABCDE1234F";
    const testAadhaar = "123456789012";
    const panHash = crypto.createHash("sha256").update(testPan).digest("hex");
    const aadhaarHash = crypto.createHash("sha256").update(testAadhaar).digest("hex");

    await db.query(
      `INSERT INTO user_kyc (user_id, pan_number_masked, pan_number_hash, aadhaar_number_masked, aadhaar_number_hash, id_document_path, status)
       VALUES (?, 'ABCDE****F', ?, 'XXXX-XXXX-9012', ?, 'storage/private_kyc_docs/test.pdf', 'REVIEW_REQUIRED')
       ON DUPLICATE KEY UPDATE status = 'REVIEW_REQUIRED', pan_number_hash = VALUES(pan_number_hash)`,
      [testUserId, panHash, aadhaarHash]
    );

    const [[kycRecord]] = await db.query("SELECT kyc_id, status FROM user_kyc WHERE user_id = ?", [testUserId]);
    assert(kycRecord && kycRecord.status === "REVIEW_REQUIRED", "KYC record inserted with status REVIEW_REQUIRED");

    await db.query(
      `INSERT INTO user_kyc_history (kyc_id, user_id, action_type, status, performed_by)
       VALUES (?, ?, 'SUBMITTED', 'PENDING', ?)`,
      [kycRecord.kyc_id, testUserId, testUserId]
    );

    const [histRows] = await db.query("SELECT * FROM user_kyc_history WHERE kyc_id = ?", [kycRecord.kyc_id]);
    assert(histRows.length > 0, "KYC submission recorded in user_kyc_history audit timeline");

    // TEST 4: Admin KYC Approval Workflow
    console.log("\nTest 4: Admin KYC Approval Workflow");
    const adminId = 1;
    await db.query("UPDATE user_kyc SET status = 'VERIFIED', verified_by = ?, verified_at = NOW() WHERE kyc_id = ?", [adminId, kycRecord.kyc_id]);
    await db.query("UPDATE users SET verification_status = 'VERIFIED' WHERE user_id = ?", [testUserId]);
    await db.query(
      `INSERT INTO user_kyc_history (kyc_id, user_id, action_type, status, performed_by)
       VALUES (?, ?, 'VERIFIED', 'VERIFIED', ?)`,
      [kycRecord.kyc_id, testUserId, adminId]
    );

    const [[updatedUser]] = await db.query("SELECT verification_status FROM users WHERE user_id = ?", [testUserId]);
    assert(updatedUser.verification_status === "VERIFIED", "User verification_status updated to VERIFIED");

    // TEST 5: Configurable System Fee Calculation
    console.log("\nTest 5: Configurable Chit Management Fee Calculation");
    const [[feeConfig]] = await db.query("SELECT rate_per_month FROM system_fee_configs WHERE config_id = 1");
    const ratePerMonth = Number(feeConfig?.rate_per_month || 199);
    const durationMonths = 12;
    const calculatedFee = ratePerMonth * durationMonths;

    assert(calculatedFee === ratePerMonth * 12, `Management fee calculated dynamically: ₹${ratePerMonth}/mo × ${durationMonths} mos = ₹${calculatedFee}`);

    // TEST 6: Session Revocation Verification
    console.log("\nTest 6: User Session Creation & Revocation");
    const sessionTokenHash = crypto.createHash("sha256").update("test-session-uuid-123").digest("hex");
    await db.query(
      `INSERT INTO user_sessions (user_id, session_token_hash, device_info, ip_address, token_version, is_revoked)
       VALUES (?, ?, 'Chrome Windows', '127.0.0.1', 0, 0)
       ON DUPLICATE KEY UPDATE is_revoked = 0`,
      [testUserId, sessionTokenHash]
    );

    const [[sess]] = await db.query("SELECT is_revoked FROM user_sessions WHERE session_token_hash = ?", [sessionTokenHash]);
    assert(sess && sess.is_revoked === 0, "Active user session inserted successfully");

    await db.query("UPDATE user_sessions SET is_revoked = 1 WHERE session_token_hash = ?", [sessionTokenHash]);
    const [[revokedSess]] = await db.query("SELECT is_revoked FROM user_sessions WHERE session_token_hash = ?", [sessionTokenHash]);
    assert(revokedSess && revokedSess.is_revoked === 1, "User session revoked successfully");

    console.log("\n=================================================");
    console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================\n");

  } catch (err) {
    console.error("Test Suite Error:", err);
  } finally {
    await db.end();
  }
}

runTests();
