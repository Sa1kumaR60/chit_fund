const mysql = require("mysql2/promise");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

async function runMigration() {
  console.log("🔄 Applying Migration 005: Expand chit_members.status ENUM...");

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "Sa1kumaR11.1",
    database: process.env.DB_NAME || "chit_fund",
  });

  try {
    await connection.query(`
      ALTER TABLE chit_members MODIFY COLUMN status ENUM(
        'INVITED',
        'ACCEPTED',
        'DOCS_PENDING',
        'VERIFIED',
        'ACTIVE',
        'PAID_CURRENT',
        'LATE_PAYMENT',
        'DEFAULTER',
        'DEFAULTED',
        'COMPLETED'
      ) NOT NULL DEFAULT 'INVITED';
    `);
    console.log("✅ Migration 005 applied successfully!");
  } catch (err) {
    console.error("❌ Migration 005 failed:", err);
  } finally {
    await connection.end();
  }
}

runMigration();
