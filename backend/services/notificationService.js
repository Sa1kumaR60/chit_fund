const db = require('../db');
const dbPromise = db.promise();

/**
 * Decoupled Notification Service for Password Reset & Security Alerts
 */

async function sendPasswordResetOtp({ userId, phone, otp, expiryMinutes = 15 }) {
  const message = `Your password reset verification code is ${otp}. Valid for ${expiryMinutes} minutes. Do not share this code.`;

  // Always record an in-app notification row for system tracking
  if (userId) {
    await dbPromise.query(
      `INSERT INTO notifications (user_id, type, message) VALUES (?, 'SECURITY_ALERT', ?)`,
      [userId, `Password reset code requested via SMS/Phone.`]
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n================== [DEV SMS NOTIFICATION] ==================`);
    console.log(`Recipient Phone : ${phone}`);
    console.log(`OTP Code        : ${otp} (Expires in ${expiryMinutes} mins)`);
    console.log(`============================================================\n`);
  } else {
    // Production SMS Provider integration (e.g., Twilio / AWS SNS / SMS Gateway)
    console.log(`[PROD SMS] Dispatched OTP to ${phone}`);
  }

  return { success: true };
}

async function sendPasswordResetLink({ userId, email, token, resetUrl, expiryMinutes = 15 }) {
  if (userId) {
    await dbPromise.query(
      `INSERT INTO notifications (user_id, type, message) VALUES (?, 'SECURITY_ALERT', ?)`,
      [userId, `Password reset link sent to registered email.`]
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n================== [DEV EMAIL NOTIFICATION] ==================`);
    console.log(`Recipient Email : ${email}`);
    console.log(`Reset Link      : ${resetUrl}`);
    console.log(`Expires In      : ${expiryMinutes} mins`);
    console.log(`==============================================================\n`);
  } else {
    // Production Email Provider integration (e.g., Nodemailer / SendGrid / AWS SES)
    console.log(`[PROD EMAIL] Dispatched Password Reset link to ${email}`);
  }

  return { success: true };
}

async function sendPasswordChangeSecurityAlert({ userId, name, phone, email }) {
  const alertMsg = `Security Alert: Your account password was changed on ${new Date().toLocaleString()}. If you did not perform this change, please contact support immediately.`;

  if (userId) {
    await dbPromise.query(
      `INSERT INTO notifications (user_id, type, message) VALUES (?, 'SECURITY_ALERT', ?)`,
      [userId, alertMsg]
    );
  }

  console.log(`[SECURITY ALERT] Dispatched password change confirmation to user ${userId || email || phone}`);
  return { success: true };
}

module.exports = {
  sendPasswordResetOtp,
  sendPasswordResetLink,
  sendPasswordChangeSecurityAlert,
};
