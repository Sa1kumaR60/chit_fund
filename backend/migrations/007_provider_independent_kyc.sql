-- Migration 007: Provider-Independent KYC Upgrade with Session Tracking & Data Minimization

-- 1. Extend user_kyc table for provider abstraction, data minimization, and new state taxonomy
ALTER TABLE user_kyc
  MODIFY COLUMN status ENUM('NOT_STARTED', 'IN_PROGRESS', 'VERIFIED', 'REVIEW_REQUIRED', 'REJECTED') NOT NULL DEFAULT 'NOT_STARTED',
  MODIFY COLUMN id_document_path VARCHAR(255) NULL,
  MODIFY COLUMN pan_number_masked VARCHAR(20) NULL,
  MODIFY COLUMN pan_number_hash VARCHAR(64) NULL,
  ADD COLUMN verification_provider VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN provider_reference_id VARCHAR(100) NULL COMMENT 'Optional audit/reconciliation ID from provider',
  ADD COLUMN reason_code VARCHAR(100) NULL;

-- 2. Create kyc_verification_sessions table for OAuth state, PKCE, and session tracking
CREATE TABLE IF NOT EXISTS kyc_verification_sessions (
  session_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  state_token VARCHAR(64) NOT NULL UNIQUE,
  provider VARCHAR(50) NOT NULL,
  code_verifier VARCHAR(128) NULL,
  status ENUM('INITIATED', 'COMPLETED', 'CANCELLED', 'FAILED', 'EXPIRED') NOT NULL DEFAULT 'INITIATED',
  reason_code VARCHAR(100) NULL,
  error_details VARCHAR(255) NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_kyc_sess_user (user_id),
  INDEX idx_kyc_sess_state (state_token),
  CONSTRAINT fk_kyc_sess_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT
);
