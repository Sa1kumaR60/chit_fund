const mysql = require("mysql2/promise");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

async function runMigration() {
  console.log("🔄 Applying Migration 006: Profile & Account Module Infrastructure...");

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "Sa1kumaR11.1",
    database: process.env.DB_NAME || "chit_fund",
  });

  try {
    // 1. Safely add columns to users table
    const addColumns = [
      `ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255) NULL`,
      `ALTER TABLE users ADD COLUMN account_status ENUM('ACTIVE', 'DEACTIVATED', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE'`,
      `ALTER TABLE users ADD COLUMN deactivated_at DATETIME NULL`,
      `ALTER TABLE users ADD COLUMN deactivation_reason VARCHAR(255) NULL`,
      `ALTER TABLE users ADD COLUMN is_email_verified TINYINT(1) NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN is_phone_verified TINYINT(1) NOT NULL DEFAULT 0`,
    ];

    for (const sql of addColumns) {
      try {
        await connection.query(sql);
      } catch (e) {
        if (e.code !== 'ER_DUP_FIELDNAME') throw e;
      }
    }

    await connection.query("UPDATE users SET is_email_verified = 1, is_phone_verified = 1 WHERE user_id IN (1, 2)");

    // 2. Create user_kyc table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_kyc (
        kyc_id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL UNIQUE,
        pan_number_masked VARCHAR(20) NOT NULL,
        pan_number_hash VARCHAR(64) NOT NULL,
        aadhaar_number_masked VARCHAR(20) NOT NULL,
        aadhaar_number_hash VARCHAR(64) NOT NULL,
        id_document_path VARCHAR(255) NOT NULL,
        status ENUM('PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
        rejection_reason VARCHAR(255) NULL,
        verified_by INT NULL,
        verified_at DATETIME NULL,
        submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_kyc_user (user_id),
        INDEX idx_kyc_pan_hash (pan_number_hash),
        INDEX idx_kyc_aadhaar_hash (aadhaar_number_hash),
        INDEX idx_kyc_status (status),
        CONSTRAINT fk_kyc_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
        CONSTRAINT fk_kyc_verifier FOREIGN KEY (verified_by) REFERENCES users(user_id) ON DELETE RESTRICT
      );
    `);

    // 3. Create user_kyc_history table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_kyc_history (
        history_id INT PRIMARY KEY AUTO_INCREMENT,
        kyc_id INT NOT NULL,
        user_id INT NOT NULL,
        action_type ENUM('SUBMITTED', 'VERIFIED', 'REJECTED', 'RESUBMITTED') NOT NULL,
        status ENUM('PENDING', 'VERIFIED', 'REJECTED') NOT NULL,
        rejection_reason VARCHAR(255) NULL,
        performed_by INT NOT NULL,
        performed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_kyc_hist_user (user_id),
        CONSTRAINT fk_kyc_hist_kyc FOREIGN KEY (kyc_id) REFERENCES user_kyc(kyc_id) ON DELETE RESTRICT,
        CONSTRAINT fk_kyc_hist_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
        CONSTRAINT fk_kyc_hist_actor FOREIGN KEY (performed_by) REFERENCES users(user_id) ON DELETE RESTRICT
      );
    `);

    // 4. Create user_notification_preferences table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_notification_preferences (
        pref_id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL UNIQUE,
        in_app_enabled TINYINT(1) NOT NULL DEFAULT 1,
        email_enabled TINYINT(1) NOT NULL DEFAULT 1,
        sms_enabled TINYINT(1) NOT NULL DEFAULT 1,
        push_enabled TINYINT(1) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_notif_pref_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
    `);

    // 5. Create admin_settlement_accounts table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS admin_settlement_accounts (
        account_id INT PRIMARY KEY AUTO_INCREMENT,
        admin_id INT NOT NULL UNIQUE,
        bank_name VARCHAR(100) NOT NULL,
        account_holder_name VARCHAR(120) NOT NULL,
        account_number_encrypted TEXT NOT NULL,
        account_number_masked VARCHAR(30) NOT NULL,
        ifsc_code VARCHAR(15) NOT NULL,
        upi_id VARCHAR(100) NULL,
        is_verified TINYINT(1) NOT NULL DEFAULT 1,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_admin_settlement_user FOREIGN KEY (admin_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
    `);

    // 6. Create admin_chit_defaults table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS admin_chit_defaults (
        setting_id INT PRIMARY KEY AUTO_INCREMENT,
        admin_id INT NOT NULL UNIQUE,
        auto_start_preference TINYINT(1) NOT NULL DEFAULT 0,
        admin_approval_required TINYINT(1) NOT NULL DEFAULT 1,
        allow_member_leave_before_start TINYINT(1) NOT NULL DEFAULT 1,
        default_grace_period_days INT NOT NULL DEFAULT 5,
        default_late_fee_rate DECIMAL(5, 4) NOT NULL DEFAULT 0.0200,
        accepted_payment_methods JSON NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_admin_defaults_user FOREIGN KEY (admin_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
    `);

    // 7. Create system_fee_configs table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS system_fee_configs (
        config_id INT PRIMARY KEY AUTO_INCREMENT,
        plan_name VARCHAR(80) NOT NULL,
        rate_per_month DECIMAL(10, 2) NOT NULL DEFAULT 199.00,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await connection.query(`
      INSERT IGNORE INTO system_fee_configs (config_id, plan_name, rate_per_month, is_active)
      VALUES (1, 'STANDARD_CHIT_MANAGEMENT', 199.00, 1);
    `);

    // 8. Create chit_management_fees table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS chit_management_fees (
        fee_id INT PRIMARY KEY AUTO_INCREMENT,
        chit_id INT NOT NULL UNIQUE,
        admin_id INT NOT NULL,
        duration_months INT NOT NULL,
        applied_rate_per_month DECIMAL(10, 2) NOT NULL,
        total_fee_amount DECIMAL(12, 2) NOT NULL,
        payment_status ENUM('PENDING', 'PAID', 'FAILED') NOT NULL DEFAULT 'PENDING',
        payment_reference VARCHAR(100) NULL,
        paid_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_mgmt_fee_chit FOREIGN KEY (chit_id) REFERENCES chits(chit_id) ON DELETE CASCADE,
        CONSTRAINT fk_mgmt_fee_admin FOREIGN KEY (admin_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
    `);

    // 9. Create user_sessions table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        session_id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        session_token_hash VARCHAR(64) NOT NULL UNIQUE,
        device_info VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        token_version INT NOT NULL,
        is_revoked TINYINT(1) NOT NULL DEFAULT 0,
        last_active_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_session_user (user_id),
        INDEX idx_session_hash (session_token_hash),
        CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
    `);

    console.log("✅ Migration 006 applied successfully!");
  } catch (err) {
    console.error("❌ Migration 006 failed:", err);
  } finally {
    await connection.end();
  }
}

runMigration();
