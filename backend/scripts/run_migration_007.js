const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const connection = await db.promise().getConnection();
  try {
    console.log("Running Migration 007: Canonical avatar_key column...");
    
    // Check if avatar_key already exists
    const [cols] = await connection.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
    );
    const colNames = cols.map(c => c.COLUMN_NAME);

    if (!colNames.includes("avatar_key")) {
      await connection.query("ALTER TABLE users ADD COLUMN avatar_key VARCHAR(255) NULL");
      console.log("Added avatar_key column to users table.");
    }

    if (colNames.includes("avatar_url")) {
      await connection.query("UPDATE users SET avatar_key = avatar_url WHERE avatar_key IS NULL AND avatar_url IS NOT NULL");
      await connection.query("ALTER TABLE users DROP COLUMN avatar_url");
      console.log("Migrated values and dropped legacy avatar_url column.");
    }

    console.log("Migration 007 completed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Migration 007 failed:", err);
    process.exit(1);
  } finally {
    connection.release();
  }
}

runMigration();
