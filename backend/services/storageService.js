const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const UPLOADS_BASE_DIR = path.join(__dirname, "../uploads");
const PRIVATE_KYC_DIR = path.join(__dirname, "../storage/private_kyc_docs");

// Ensure base directories exist
if (!fs.existsSync(UPLOADS_BASE_DIR)) {
  fs.mkdirSync(UPLOADS_BASE_DIR, { recursive: true });
}
if (!fs.existsSync(PRIVATE_KYC_DIR)) {
  fs.mkdirSync(PRIVATE_KYC_DIR, { recursive: true });
}

/**
 * Saves a pre-processed WebP image buffer for a user to local storage.
 * Standard Storage Key structure: avatars/users/{userId}/{randomHex}.webp
 */
function saveAvatar(buffer, userId) {
  if (!buffer || !userId) {
    throw new Error("Buffer and userId are required to save avatar.");
  }
  const randomHex = crypto.randomBytes(16).toString("hex");
  const relativeKey = `avatars/users/${userId}/${randomHex}.webp`;
  const absoluteDir = path.join(UPLOADS_BASE_DIR, `avatars/users/${userId}`);

  if (!fs.existsSync(absoluteDir)) {
    fs.mkdirSync(absoluteDir, { recursive: true });
  }

  const absolutePath = path.join(UPLOADS_BASE_DIR, relativeKey);
  fs.writeFileSync(absolutePath, buffer);
  return relativeKey;
}

/**
 * Safely deletes an avatar file given its relative storage key.
 */
function deleteAvatar(avatarKey) {
  if (!avatarKey || typeof avatarKey !== "string") return false;
  
  // Normalize and resolve absolute path
  const normalizedKey = avatarKey.replace(/^[\/\\]+/, "");
  const absolutePath = path.resolve(path.join(UPLOADS_BASE_DIR, normalizedKey));
  const resolvedUploadsBase = path.resolve(UPLOADS_BASE_DIR);

  // Security check against directory traversal
  if (!absolutePath.startsWith(resolvedUploadsBase)) {
    console.warn(`[StorageService] Security Warning: Prevented directory traversal attempt for key: ${avatarKey}`);
    return false;
  }

  try {
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
      return true;
    }
  } catch (err) {
    console.error(`[StorageService] Error unlinking avatar file ${absolutePath}:`, err);
  }
  return false;
}

/**
 * Converts a storage key into a client-accessible URL.
 */
function getAvatarUrl(avatarKey) {
  if (!avatarKey) return null;
  if (avatarKey.startsWith("http://") || avatarKey.startsWith("https://")) {
    return avatarKey;
  }
  const baseUrl = process.env.APP_URL || "http://localhost:5000";
  const cleanKey = avatarKey.replace(/^[\/\\]+/, "").replace(/\\/g, "/");
  return `${baseUrl}/uploads/${cleanKey}`;
}

/**
 * KYC Private Document Storage (Preserved 100% isolated)
 */
function savePrivateKycDocument(buffer, originalName) {
  const ext = path.extname(originalName).toLowerCase() || ".pdf";
  const validExts = [".pdf", ".jpg", ".jpeg", ".png"];
  if (!validExts.includes(ext)) {
    throw new Error("Invalid document format. Allowed: PDF, JPG, PNG.");
  }
  const filename = `kyc-doc-${crypto.randomBytes(16).toString("hex")}${ext}`;
  const filePath = path.join(PRIVATE_KYC_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

module.exports = {
  saveAvatar,
  deleteAvatar,
  getAvatarUrl,
  savePrivateKycDocument,
  PRIVATE_KYC_DIR,
};
