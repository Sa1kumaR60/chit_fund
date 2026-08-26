const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const db = require("./db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const {
  register,
  login,
  requestPasswordReset,
  verifyResetOtp,
  resetPassword,
  adminInitiatedReset,
} = require("./controllers/authController");
const { authMiddleware } = require("./middleware/authMiddleware");

const dbPromise = db.promise();

async function runTestSuite() {
  console.log("🧪 Starting Comprehensive Password Reset & Security Verification Test Suite...\n");

  try {
    // Ensure test user exists in DB
    const adminPassword = await bcrypt.hash("Admin@123", 10);
    const memberPassword = await bcrypt.hash("Member@123", 10);
    
    await dbPromise.query("SET FOREIGN_KEY_CHECKS = 0");
    await dbPromise.query("TRUNCATE TABLE password_reset_tokens");
    await dbPromise.query("TRUNCATE TABLE audit_logs");
    await dbPromise.query("TRUNCATE TABLE users");
    await dbPromise.query("SET FOREIGN_KEY_CHECKS = 1");

    await dbPromise.query(
      `INSERT INTO users (user_id, name, phone, email, password_hash, role, verification_status, merit_score, token_version)
       VALUES (1, 'Super Admin', '9999999999', 'admin@chitfund.com', ?, 'ADMIN', 'VERIFIED', 100, 0)`,
      [adminPassword]
    );

    await dbPromise.query(
      `INSERT INTO users (user_id, name, phone, email, password_hash, role, verification_status, merit_score, token_version)
       VALUES (2, 'Rahul Sharma', '9876543210', 'rahul@gmail.com', ?, 'MEMBER', 'VERIFIED', 100, 0)`,
      [memberPassword]
    );

    // Test User details
    const testUser = {
      name: "Test Member",
      phone: "9876543210",
      email: "rahul@gmail.com",
      password: "Member@123",
    };

    // 1. Existing user login still works
    console.log("▶ Test 1: Existing user login with bcrypt...");
    const loginRes1 = await runController(login, { body: { phone: testUser.phone, password: testUser.password } });
    assert(loginRes1.statusCode === 200, "Initial login should return 200");
    assert(loginRes1.data.token, "Initial login should return JWT token");
    const oldJwtToken = loginRes1.data.token;
    console.log("✅ Passed: Existing user login works with bcrypt.\n");

    // 2. Auth middleware allows valid old token
    console.log("▶ Test 2: authMiddleware validation with active session token...");
    const authReq1 = { headers: { authorization: `Bearer ${oldJwtToken}` } };
    const authRes1 = await runMiddleware(authMiddleware, authReq1);
    assert(authRes1.nextCalled, "Middleware should pass for valid active token");
    console.log("✅ Passed: authMiddleware accepts valid active token.\n");

    // 3. Forgot password with registered phone
    console.log("▶ Test 3: Forgot password with registered phone...");
    const reqPhoneRes = await runController(requestPasswordReset, { body: { identifier: testUser.phone } });
    if (reqPhoneRes.statusCode !== 200) console.log("REQ PHONE FAIL:", reqPhoneRes);
    assert(reqPhoneRes.statusCode === 200, `Phone reset request should return 200 but got ${reqPhoneRes.statusCode}`);
    assert(reqPhoneRes.data.message.includes("password reset instructions have been sent"), "Generic message returned");
    assert(!reqPhoneRes.data.otp && !reqPhoneRes.data.token, "Raw OTP/token MUST NOT be returned in API response");
    console.log("✅ Passed: Generic non-enumerating response returned for registered phone.\n");

    // Retrieve generated hashed OTP from DB for verification test
    const [[tokenRowPhone]] = await dbPromise.query(
      `SELECT prt.*, u.phone FROM password_reset_tokens prt 
       JOIN users u ON u.user_id = prt.user_id 
       WHERE u.phone = ? AND prt.used_at IS NULL ORDER BY prt.created_at DESC LIMIT 1`,
      [testUser.phone]
    );
    assert(tokenRowPhone, "Token row created in password_reset_tokens table");
    assert(tokenRowPhone.channel === "PHONE", "Channel is PHONE");
    assert(tokenRowPhone.token_hash.length === 64, "Token hash is 64-char SHA-256 string");

    // 4. Forgot password with registered email
    console.log("▶ Test 4: Forgot password with registered email...");
    const reqEmailRes = await runController(requestPasswordReset, { body: { identifier: testUser.email } });
    assert(reqEmailRes.statusCode === 200, "Email reset request should return 200");
    assert(reqEmailRes.data.message === reqPhoneRes.data.message, "Response message MUST be identical for anti-enumeration");
    console.log("✅ Passed: Generic non-enumerating response returned for registered email.\n");

    // 5. Requesting a new reset invalidates the previous reset credential
    console.log("▶ Test 5: Re-requesting reset invalidates prior active token...");
    const [[priorToken]] = await dbPromise.query(
      "SELECT * FROM password_reset_tokens WHERE reset_id = ?",
      [tokenRowPhone.reset_id]
    );
    assert(priorToken.used_at !== null, "Prior token marked used/invalidated on new request");
    console.log("✅ Passed: Prior reset credentials invalidated on new request.\n");

    // 6. Forgot password with unknown phone/email
    console.log("▶ Test 6: Forgot password with unknown phone/email...");
    const reqUnknownRes = await runController(requestPasswordReset, { body: { identifier: "9990001112" } });
    assert(reqUnknownRes.statusCode === 200, "Unknown account request should return 200");
    assert(reqUnknownRes.data.message === reqPhoneRes.data.message, "Response message MUST be identical for unknown accounts");
    console.log("✅ Passed: Account enumeration prevented for unknown accounts.\n");

    // 7. Wrong OTP & Attempt Counting
    console.log("▶ Test 7: OTP verification failure & attempt counting...");
    const reqPhoneRes2 = await runController(requestPasswordReset, { body: { identifier: testUser.phone } });
    const [[activePhoneToken]] = await dbPromise.query(
      `SELECT prt.* FROM password_reset_tokens prt JOIN users u ON u.user_id = prt.user_id WHERE u.phone = ? AND prt.used_at IS NULL ORDER BY prt.created_at DESC LIMIT 1`,
      [testUser.phone]
    );
    
    const wrongOtpRes = await runController(verifyResetOtp, { body: { phone: testUser.phone, otp: "000000" } });
    assert(wrongOtpRes.statusCode === 400, "Wrong OTP should return 400");
    assert(wrongOtpRes.data.attemptsRemaining === 4, "Attempts remaining should be 4");

    const [[attemptsRow]] = await dbPromise.query(
      "SELECT attempt_count FROM password_reset_tokens WHERE reset_id = ?",
      [activePhoneToken.reset_id]
    );
    assert(attemptsRow.attempt_count === 1, "Attempt count incremented in DB");
    console.log("✅ Passed: Wrong OTP fails and increments attempt_count.\n");

    // 8. Max 5 Failed OTP Attempts Lockout
    console.log("▶ Test 8: 5 failed OTP attempts lockout...");
    await dbPromise.query(
      "UPDATE password_reset_tokens SET attempt_count = 5 WHERE reset_id = ?",
      [activePhoneToken.reset_id]
    );
    const lockedRes = await runController(verifyResetOtp, { body: { phone: testUser.phone, otp: "000000" } });
    assert(lockedRes.statusCode === 400, "Lockout should return 400");
    assert(lockedRes.data.message.includes("Maximum verification attempts exceeded"), "Lockout message returned");
    console.log("✅ Passed: 5 failed OTP attempts locks out token.\n");

    // 9. Expired Token Validation
    console.log("▶ Test 9: Expired OTP/token rejection...");
    const reqPhoneRes3 = await runController(requestPasswordReset, { body: { identifier: testUser.phone } });
    const [[expiredTokenRow]] = await dbPromise.query(
      `SELECT prt.* FROM password_reset_tokens prt JOIN users u ON u.user_id = prt.user_id WHERE u.phone = ? AND prt.used_at IS NULL ORDER BY prt.created_at DESC LIMIT 1`,
      [testUser.phone]
    );
    await dbPromise.query(
      "UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE reset_id = ?",
      [expiredTokenRow.reset_id]
    );
    const expiredRes = await runController(verifyResetOtp, { body: { phone: testUser.phone, otp: "123456" } });
    assert(expiredRes.statusCode === 400, "Expired token should return 400");
    assert(expiredRes.data.message.includes("expired"), "Expired message returned");
    console.log("✅ Passed: Expired tokens/OTPs are rejected immediately.\n");

    // 10. Successful Password Reset & Session Invalidation
    console.log("▶ Test 10: Successful password reset & instant session invalidation...");
    // Create new fresh request for phone
    await runController(requestPasswordReset, { body: { identifier: testUser.phone } });
    const [[freshTokenRow]] = await dbPromise.query(
      `SELECT prt.* FROM password_reset_tokens prt JOIN users u ON u.user_id = prt.user_id WHERE u.phone = ? AND prt.used_at IS NULL ORDER BY prt.created_at DESC LIMIT 1`,
      [testUser.phone]
    );

    // Simulate obtaining verified resetAuthToken
    const resetAuthToken = jwt.sign(
      { userId: freshTokenRow.user_id, resetId: freshTokenRow.reset_id, purpose: "PASSWORD_RESET" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    const newPasswordStr = "NewSecurePass@2026";
    const resetRes = await runController(resetPassword, {
      body: { resetAuthToken, newPassword: newPasswordStr },
    });

    assert(resetRes.statusCode === 200, "Password reset should return 200");
    assert(resetRes.data.message.includes("Password reset successful"), "Success message returned");

    // Verify token marked used
    const [[usedRow]] = await dbPromise.query(
      "SELECT used_at FROM password_reset_tokens WHERE reset_id = ?",
      [freshTokenRow.reset_id]
    );
    assert(usedRow.used_at !== null, "Token marked as used_at in DB");

    // Verify user token_version incremented
    const [[userRowAfter]] = await dbPromise.query(
      "SELECT token_version, password_changed_at FROM users WHERE user_id = ?",
      [freshTokenRow.user_id]
    );
    assert(userRowAfter.token_version === 1, "token_version incremented to 1");
    assert(userRowAfter.password_changed_at !== null, "password_changed_at updated");
    console.log("✅ Passed: Password reset successful, token_version incremented.\n");

    // 11. Old JWT becomes invalid immediately
    console.log("▶ Test 11: Old JWT token invalidation verification...");
    const authResOld = await runMiddleware(authMiddleware, { headers: { authorization: `Bearer ${oldJwtToken}` } });
    assert(authResOld.statusCode === 401, "Old JWT token MUST be rejected with 401");
    assert(authResOld.data.sessionRevoked === true, "Session revoked flag returned");
    console.log("✅ Passed: Old JWT tokens immediately revoked on all devices.\n");

    // 12. User logs in with NEW password & OLD password fails
    console.log("▶ Test 12: Login with new password vs old password...");
    const oldLoginRes = await runController(login, { body: { phone: testUser.phone, password: testUser.password } });
    assert(oldLoginRes.statusCode === 401, "Old password login MUST fail with 401");

    const newLoginRes = await runController(login, { body: { phone: testUser.phone, password: newPasswordStr } });
    assert(newLoginRes.statusCode === 200, "New password login MUST succeed with 200");
    assert(newLoginRes.data.token, "New JWT token issued");
    const newJwtToken = newLoginRes.data.token;
    console.log("✅ Passed: New password works and old password fails.\n");

    // 13. Reusing an already-used token fails
    console.log("▶ Test 13: Reusing an already-used token...");
    const reuseRes = await runController(resetPassword, {
      body: { resetAuthToken, newPassword: "AnotherPassword@1" },
    });
    assert(reuseRes.statusCode === 400, "Reusing used token MUST fail with 400");
    console.log("✅ Passed: Used reset tokens cannot be reused.\n");

    // 14. Admin-Assisted Reset
    console.log("▶ Test 14: Admin-assisted password reset...");
    const adminReq = {
      user: { id: 1, role: "ADMIN" },
      body: { memberId: freshTokenRow.user_id },
      ip: "127.0.0.1",
    };
    const adminResetRes = await runController(adminInitiatedReset, adminReq);
    assert(adminResetRes.statusCode === 200, "Admin reset should return 200");
    assert(!adminResetRes.data.password && !adminResetRes.data.otp, "Admin MUST NOT see plaintext password/OTP");
    console.log("✅ Passed: Admin initiated reset triggered securely without exposing credentials.\n");

    // 15. Audit Log Verification
    console.log("▶ Test 15: Security Audit Log verification...");
    const [logs] = await dbPromise.query(
      `SELECT action_type FROM audit_logs WHERE reference_type = 'USER' AND reference_id = ? ORDER BY audit_id ASC`,
      [freshTokenRow.user_id]
    );
    const actionTypes = logs.map(l => l.action_type);
    assert(actionTypes.includes("PASSWORD_RESET_REQUESTED"), "PASSWORD_RESET_REQUESTED logged");
    assert(actionTypes.includes("PASSWORD_RESET_SUCCESSFUL"), "PASSWORD_RESET_SUCCESSFUL logged");
    assert(actionTypes.includes("ADMIN_INITIATED_PASSWORD_RESET"), "ADMIN_INITIATED_PASSWORD_RESET logged");
    console.log("✅ Passed: All security events logged in audit_logs table.\n");

    console.log("🎉 ALL 15 VERIFICATION TESTS PASSED SUCCESSFULLY WITH ZERO ERRORS!");
    process.exit(0);

  } catch (error) {
    console.error("❌ Test Failed:", error);
    process.exit(1);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

function runController(controllerFn, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      data: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.data = data;
        resolve(this);
      },
    };
    try {
      const result = controllerFn(req, res);
      if (result && typeof result.catch === 'function') {
        result.catch((err) => resolve({ statusCode: 500, data: { message: err.message } }));
      }
    } catch (err) {
      resolve({ statusCode: 500, data: { message: err.message } });
    }
  });
}

function runMiddleware(middlewareFn, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      data: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.data = data;
        resolve(this);
      },
    };
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
      resolve({ statusCode: 200, nextCalled });
    };
    middlewareFn(req, res, next).catch((err) => resolve({ statusCode: 500, data: { message: err.message } }));
  });
}

runTestSuite();
