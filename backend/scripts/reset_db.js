const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

async function resetDatabase() {
  console.log("🔄 Starting database reset and schema initialization...");

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "Sa1kumaR11.1",
    multipleStatements: true,
  });

  const dbName = process.env.DB_NAME || "chit_fund";

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    await connection.query(`USE \`${dbName}\`;`);

    // Disable foreign key checks for table drops
    await connection.query("SET FOREIGN_KEY_CHECKS = 0;");

    const tables = [
      "password_reset_tokens",
      "member_reliability_history",
      "monthly_reports",
      "audit_logs",
      "notifications",
      "transactions",
      "wallets",
      "bids",
      "auctions",
      "monthly_pools",
      "penalties",
      "payments",
      "chit_members",
      "chit_invitations",
      "chit_member_slots",
      "chit_monthly_rules",
      "chits",
      "users",
    ];

    for (const table of tables) {
      await connection.query(`DROP TABLE IF EXISTS \`${table}\`;`);
    }
    console.log("✅ Cleared existing tables.");

    await connection.query("SET FOREIGN_KEY_CHECKS = 1;");

    const schemaSql = fs.readFileSync(
      path.join(__dirname, "../schema.sql"),
      "utf-8"
    );

    await connection.query(schemaSql);
    console.log("✅ Applied schema.sql successfully.");

    // Seed default Admin
    const adminPassword = await bcrypt.hash("Admin@123", 10);
    const [adminResult] = await connection.execute(
      `INSERT INTO users (name, phone, email, password_hash, role, verification_status, merit_score)
       VALUES (?, ?, ?, ?, 'ADMIN', 'VERIFIED', 100)`,
      ["Super Admin", "9999999999", "admin@chitfund.com", adminPassword]
    );
    const adminId = adminResult.insertId;

    // Seed Admin Wallet
    await connection.execute(
      `INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)`,
      [adminId]
    );

    // Seed 2 default Members for quick testing
    const memberPassword = await bcrypt.hash("Member@123", 10);
    const members = [
      { name: "Rahul Sharma", phone: "9876543210", email: "rahul@gmail.com" },
      { name: "Priya Verma", phone: "9876543211", email: "priya@gmail.com" },
    ];

    for (const m of members) {
      const [mRes] = await connection.execute(
        `INSERT INTO users (name, phone, email, password_hash, role, verification_status, merit_score)
         VALUES (?, ?, ?, ?, 'MEMBER', 'VERIFIED', 100)`,
        [m.name, m.phone, m.email, memberPassword]
      );
      await connection.execute(
        `INSERT INTO wallets (user_id, balance) VALUES (?, 50000.00)`,
        [mRes.insertId]
      );
    }

    console.log("🎉 Database reset complete!");
    console.log("   Admin login: admin@chitfund.com / Admin@123");
    console.log("   Member login: rahul@gmail.com / Member@123");

  } catch (err) {
    console.error("❌ Database reset error:", err);
  } finally {
    await connection.end();
  }
}

resetDatabase();
