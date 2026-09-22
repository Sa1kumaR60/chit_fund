const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const SECRET_KEY = process.env.SETTLEMENT_ENCRYPTION_KEY || "12345678901234567890123456789012"; // 32-byte key

function encryptText(plainText) {
  if (!plainText) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(SECRET_KEY, "utf-8"), iv);
  
  let encrypted = cipher.update(String(plainText), "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  // Format: iv:authTag:encryptedHex
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

function decryptText(encryptedPayload) {
  if (!encryptedPayload) return null;
  const parts = encryptedPayload.split(":");
  if (parts.length !== 3) return null;

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(SECRET_KEY, "utf-8"), iv);
  
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

function maskAccountNumber(accountNo) {
  if (!accountNo) return "";
  const str = String(accountNo).trim();
  if (str.length <= 4) return "****" + str;
  const visible = str.slice(-4);
  const maskedLength = str.length - 4;
  return "X".repeat(Math.max(4, maskedLength)) + visible;
}

module.exports = {
  encryptText,
  decryptText,
  maskAccountNumber,
};
