const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { saveAvatar, deleteAvatar, getAvatarUrl } = require("./services/storageService");

async function runAvatarTests() {
  console.log("=================================================");
  console.log("🧪 STARTING AVATAR LIFECYCLE TEST SUITE");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ PASSED: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: ${testName}`);
      failed++;
    }
  }

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "Sa1kumaR11.1",
    database: process.env.DB_NAME || "chit_fund",
  });

  try {
    const testUserId = 2; // Member Rahul

    // 1. Image Processing & Sharp 512x512 WebP Conversion
    console.log("Test 1: Sharp Image Validation & 512x512 WebP Crop");
    const testBuffer = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 4,
        background: { r: 0, g: 128, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const processedBuffer = await sharp(testBuffer)
      .resize(512, 512, { fit: "cover", position: "center" })
      .toFormat("webp", { quality: 85 })
      .toBuffer();

    const metadata = await sharp(processedBuffer).metadata();
    assert(metadata.width === 512 && metadata.height === 512, "Resized image has exact 512x512 dimensions");
    assert(metadata.format === "webp", "Converted image format is WebP");

    // 2. StorageService Key Generation & File Creation
    console.log("\nTest 2: StorageService Key Generation & Physical File Creation");
    const avatarKey = saveAvatar(processedBuffer, testUserId);
    assert(avatarKey.startsWith(`avatars/users/${testUserId}/`), `Key structure matches avatars/users/${testUserId}/... (${avatarKey})`);

    const absolutePath = path.join(__dirname, "uploads", avatarKey);
    assert(fs.existsSync(absolutePath), "Physical .webp file written to local disk uploads directory");

    const formattedUrl = getAvatarUrl(avatarKey);
    assert(formattedUrl.includes(`/uploads/${avatarKey}`), `Generated API URL is valid (${formattedUrl})`);

    // 3. Single Canonical Column MySQL Storage (users.avatar_key)
    console.log("\nTest 3: Database Update using avatar_key Column");
    await db.query("UPDATE users SET avatar_key = ? WHERE user_id = ?", [avatarKey, testUserId]);
    const [[user]] = await db.query("SELECT avatar_key FROM users WHERE user_id = ?", [testUserId]);
    assert(user.avatar_key === avatarKey, "users.avatar_key updated correctly in database");

    // 4. Avatar Replacement Lifecycle & Old File Cleanup
    console.log("\nTest 4: Avatar Replacement Lifecycle & Physical File Cleanup");
    const newBuffer = await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .resize(512, 512, { fit: "cover" })
      .toFormat("webp")
      .toBuffer();

    const newAvatarKey = saveAvatar(newBuffer, testUserId);
    await db.query("UPDATE users SET avatar_key = ? WHERE user_id = ?", [newAvatarKey, testUserId]);

    // Cleanup old file
    const deleted = deleteAvatar(avatarKey);
    assert(deleted === true, "Previous physical avatar file successfully unlinked");
    assert(!fs.existsSync(absolutePath), "Old file no longer exists on disk");

    // 5. Avatar Deletion Lifecycle
    console.log("\nTest 5: Avatar Deletion & Reset to NULL");
    await db.query("UPDATE users SET avatar_key = NULL WHERE user_id = ?", [testUserId]);
    const [[userAfterDelete]] = await db.query("SELECT avatar_key FROM users WHERE user_id = ?", [testUserId]);
    assert(userAfterDelete.avatar_key === null, "users.avatar_key set to NULL in database");

    deleteAvatar(newAvatarKey);
    const newAbsolutePath = path.join(__dirname, "uploads", newAvatarKey);
    assert(!fs.existsSync(newAbsolutePath), "New file unlinked upon deletion");

    console.log("\n=================================================");
    console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================\n");
  } catch (err) {
    console.error("Avatar Suite Error:", err);
  } finally {
    await db.end();
  }
}

runAvatarTests();
