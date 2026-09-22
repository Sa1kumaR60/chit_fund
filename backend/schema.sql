-- Complete Database Schema for Smart Chit Fund System with Advanced Chit Creation & Rule Engine

CREATE TABLE IF NOT EXISTS users (
  user_id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('ADMIN', 'MEMBER') NOT NULL,
  verification_status ENUM('PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  merit_score INT NOT NULL DEFAULT 100,
  token_version INT NOT NULL DEFAULT 0,
  password_changed_at DATETIME NULL,
  avatar_key VARCHAR(255) NULL,
  account_status ENUM('ACTIVE', 'DEACTIVATED', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  deactivated_at DATETIME NULL,
  deactivation_reason VARCHAR(255) NULL,
  is_email_verified TINYINT(1) NOT NULL DEFAULT 0,
  is_phone_verified TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chits (
  chit_id INT PRIMARY KEY AUTO_INCREMENT,
  group_name VARCHAR(255) NOT NULL DEFAULT 'Unnamed Chit Group',
  admin_id INT NOT NULL,
  type ENUM('FIXED', 'AUCTION') NOT NULL DEFAULT 'FIXED',
  status ENUM('DRAFT', 'WAITING_CONFIG', 'WAITING_MEMBERS', 'READY_TO_START', 'ACTIVE', 'AUCTION_RUNNING', 'PAYMENT_COLLECTION', 'COMPLETED', 'CLOSED') NOT NULL DEFAULT 'DRAFT',
  chit_value DECIMAL(12, 2) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  monthly_due_date INT NOT NULL DEFAULT 5,
  grace_period_days INT NOT NULL DEFAULT 5,
  duration_months INT NOT NULL,
  total_members INT NOT NULL,
  minimum_members_required INT NOT NULL DEFAULT 1,
  minimum_collection_required DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  monthly_installment DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  late_fee_rate DECIMAL(5, 4) NOT NULL DEFAULT 0.0200,
  admin_commission_rate DECIMAL(5, 4) NOT NULL DEFAULT 0.0500,
  reserve_rate DECIMAL(5, 4) NOT NULL DEFAULT 0.0200,
  description TEXT,
  auction_method ENUM('HIGHEST_DISCOUNT', 'LOWEST_BID', 'MANUAL_WINNER', 'HYBRID') NULL,
  max_discount_allowed DECIMAL(12, 2) NULL,
  min_bid_amount DECIMAL(12, 2) NULL,
  auction_start_time VARCHAR(20) NULL DEFAULT '10:00',
  auction_end_time VARCHAR(20) NULL DEFAULT '18:00',
  auction_day_of_month INT NULL DEFAULT 10,
  commission_payout_timing ENUM('MONTHLY', 'ON_PAYOUT') NOT NULL DEFAULT 'MONTHLY',
  winner_calc_formula VARCHAR(100) DEFAULT 'TOTAL_MINUS_DISCOUNT_MINUS_COMMISSION',
  dividend_calc_formula VARCHAR(100) DEFAULT 'DISCOUNT_DIVIDED_NON_WINNERS',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_chits_admin FOREIGN KEY (admin_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS chit_monthly_rules (
  rule_id INT PRIMARY KEY AUTO_INCREMENT,
  chit_id INT NOT NULL,
  month_number INT NOT NULL,
  fixed_installment_amount DECIMAL(12, 2) NULL,
  winner_pays_amount DECIMAL(12, 2) NULL,
  non_winner_pays_amount DECIMAL(12, 2) NULL,
  min_discount DECIMAL(12, 2) NULL,
  max_discount DECIMAL(12, 2) NULL,
  commission_rate DECIMAL(5, 4) NULL,
  penalty_rate DECIMAL(5, 4) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chit_month_rule (chit_id, month_number),
  CONSTRAINT fk_chit_monthly_rules_chit FOREIGN KEY (chit_id) REFERENCES chits(chit_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chit_member_slots (
  slot_id INT PRIMARY KEY AUTO_INCREMENT,
  chit_id INT NOT NULL,
  assigned_month INT NOT NULL,
  member_name VARCHAR(120) NULL,
  invitee_phone VARCHAR(20) NULL,
  invitee_email VARCHAR(190) NULL,
  member_id INT NULL,
  invitation_token VARCHAR(64) NULL,
  status ENUM('RESERVED', 'INVITED', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'RESERVED',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chit_slot_month (chit_id, assigned_month),
  CONSTRAINT fk_chit_member_slots_chit FOREIGN KEY (chit_id) REFERENCES chits(chit_id) ON DELETE CASCADE,
  CONSTRAINT fk_chit_member_slots_user FOREIGN KEY (member_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS chit_invitations (
  invitation_id INT PRIMARY KEY AUTO_INCREMENT,
  chit_id INT NOT NULL,
  user_id INT NULL,
  invitee_phone VARCHAR(20) NULL,
  invitee_email VARCHAR(190) NULL,
  invitation_token VARCHAR(64) NULL UNIQUE,
  status ENUM('PENDING', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_chit_invitations_chit FOREIGN KEY (chit_id) REFERENCES chits(chit_id) ON DELETE CASCADE,
  CONSTRAINT fk_chit_invitations_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS chit_members (
  chit_member_id INT PRIMARY KEY AUTO_INCREMENT,
  chit_id INT NOT NULL,
  member_id INT NOT NULL,
  assigned_month INT NULL,
  status ENUM('INVITED', 'ACCEPTED', 'DOCS_PENDING', 'VERIFIED', 'ACTIVE', 'PAID_CURRENT', 'LATE_PAYMENT', 'DEFAULTER', 'DEFAULTED', 'COMPLETED') NOT NULL DEFAULT 'INVITED',
  unpaid_streak INT NOT NULL DEFAULT 0,
  total_missed_count INT NOT NULL DEFAULT 0,
  has_won_auction TINYINT(1) NOT NULL DEFAULT 0,
  invitation_token VARCHAR(64) NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chit_member (chit_id, member_id),
  CONSTRAINT fk_chit_members_chit FOREIGN KEY (chit_id) REFERENCES chits(chit_id) ON DELETE CASCADE,
  CONSTRAINT fk_chit_members_member FOREIGN KEY (member_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  payment_id INT PRIMARY KEY AUTO_INCREMENT,
  chit_id INT NOT NULL,
  member_id INT NOT NULL,
  installment_number INT NOT NULL,
  due_date DATE NOT NULL,
  paid_at DATETIME NOT NULL,
  amount_due DECIMAL(12, 2) NOT NULL,
  late_fee DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  amount_paid DECIMAL(12, 2) NOT NULL,
  payment_mode VARCHAR(40) NOT NULL DEFAULT 'UPI',
  payment_status ENUM('PAID_ON_TIME', 'PAID_EARLY', 'LATE_PAYMENT', 'UNPAID') NOT NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payment_installment (chit_id, member_id, installment_number),
  CONSTRAINT fk_payments_chit FOREIGN KEY (chit_id) REFERENCES chits(chit_id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_member FOREIGN KEY (member_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS penalties (
  penalty_id INT PRIMARY KEY AUTO_INCREMENT,
  payment_id INT NULL,
  chit_id INT NOT NULL,
  member_id INT NOT NULL,
  installment_number INT NOT NULL,
  penalty_type ENUM('LATE_FEE', 'DEFAULTER') NOT NULL,
  rate_applied DECIMAL(5, 4) NOT NULL DEFAULT 0.0000,
  amount DECIMAL(12, 2) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  status ENUM('PENDING', 'APPLIED', 'WAIVED') NOT NULL DEFAULT 'APPLIED',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_penalties_payment FOREIGN KEY (payment_id) REFERENCES payments(payment_id) ON DELETE SET NULL,
  CONSTRAINT fk_penalties_chit FOREIGN KEY (chit_id) REFERENCES chits(chit_id) ON DELETE CASCADE,
  CONSTRAINT fk_penalties_member FOREIGN KEY (member_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS monthly_pools (
  pool_id INT PRIMARY KEY AUTO_INCREMENT,
  chit_id INT NOT NULL,
  installment_number INT NOT NULL,
  expected_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  pool_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  paid_member_count INT NOT NULL DEFAULT 0,
  required_member_count INT NOT NULL DEFAULT 0,
  minimum_collection_required DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  pending_installment_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  auction_id INT NULL,
  auction_winner_id INT NULL,
  discount_percent DECIMAL(5, 2) NULL,
  discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  commission_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  reserve_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  winner_payout DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  distributed_discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  status ENUM('COLLECTING', 'READY', 'LOCKED', 'SETTLED', 'CANCELLED') NOT NULL DEFAULT 'COLLECTING',
  manually_approved TINYINT(1) NOT NULL DEFAULT 0,
  approved_by INT NULL,
  approved_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_monthly_pool (chit_id, installment_number),
  CONSTRAINT fk_monthly_pools_chit FOREIGN KEY (chit_id) REFERENCES chits(chit_id) ON DELETE CASCADE,
  CONSTRAINT fk_monthly_pools_winner FOREIGN KEY (auction_winner_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_monthly_pools_approver FOREIGN KEY (approved_by) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS auctions (
  auction_id INT PRIMARY KEY AUTO_INCREMENT,
  chit_id INT NOT NULL,
  installment_number INT NOT NULL,
  pool_id INT NULL,
  pool_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  paid_member_count INT NOT NULL DEFAULT 0,
  admin_commission_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  reserve_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  auction_base_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  winning_member_id INT NULL,
  winning_discount_percent DECIMAL(5, 2) NULL,
  winning_discount_amount DECIMAL(12, 2) NULL,
  winning_payout DECIMAL(12, 2) NULL,
  distribution_per_member DECIMAL(12, 2) NULL,
  distributed_discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  eligible_dividend_count INT NOT NULL DEFAULT 0,
  manually_approved_partial TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
  started_at TIMESTAMP NULL,
  closed_at DATETIME NULL,
  UNIQUE KEY uq_auction_installment (chit_id, installment_number),
  CONSTRAINT fk_auctions_chit FOREIGN KEY (chit_id) REFERENCES chits(chit_id) ON DELETE CASCADE,
  CONSTRAINT fk_auctions_pool FOREIGN KEY (pool_id) REFERENCES monthly_pools(pool_id) ON DELETE SET NULL,
  CONSTRAINT fk_auctions_winner FOREIGN KEY (winning_member_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS bids (
  bid_id INT PRIMARY KEY AUTO_INCREMENT,
  auction_id INT NOT NULL,
  chit_id INT NOT NULL,
  member_id INT NOT NULL,
  discount_percent DECIMAL(5, 2) NOT NULL,
  discount_amount DECIMAL(12, 2) NOT NULL,
  estimated_payout DECIMAL(12, 2) NOT NULL,
  distribution_per_member DECIMAL(12, 2) NOT NULL,
  bid_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_winner TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_bids_auction FOREIGN KEY (auction_id) REFERENCES auctions(auction_id) ON DELETE CASCADE,
  CONSTRAINT fk_bids_chit FOREIGN KEY (chit_id) REFERENCES chits(chit_id) ON DELETE CASCADE,
  CONSTRAINT fk_bids_member FOREIGN KEY (member_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wallets (
  wallet_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL UNIQUE,
  balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_wallets_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id INT PRIMARY KEY AUTO_INCREMENT,
  wallet_id INT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  type ENUM('DEPOSIT', 'WITHDRAWAL', 'INSTALLMENT_PAYMENT', 'AUCTION_WINNING', 'DIVIDEND', 'LATE_FEE', 'COMMISSION', 'RESERVE', 'REFUND', 'BONUS', 'CASHBACK', 'MANUAL_ADJUSTMENT') NOT NULL,
  reference_id INT NULL,
  reference_type ENUM('PAYMENT', 'AUCTION', 'SYSTEM', 'CHIT') NULL,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_transactions_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(wallet_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  notification_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NULL,
  action_type VARCHAR(80) NOT NULL,
  reference_type VARCHAR(40) NOT NULL DEFAULT 'SYSTEM',
  reference_id INT NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS monthly_reports (
  report_id INT PRIMARY KEY AUTO_INCREMENT,
  chit_id INT NOT NULL,
  month_number INT NOT NULL,
  collected_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  pending_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  paid_count INT NOT NULL DEFAULT 0,
  unpaid_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_monthly_report (chit_id, month_number),
  CONSTRAINT fk_monthly_reports_chit FOREIGN KEY (chit_id) REFERENCES chits(chit_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS member_reliability_history (
  history_id INT PRIMARY KEY AUTO_INCREMENT,
  member_id INT NOT NULL,
  chit_id INT NULL,
  event_type ENUM('EARLY_PAYMENT', 'ON_TIME_PAYMENT', 'LATE_PAYMENT', 'MISSED_PAYMENT', 'DEFAULTED') NOT NULL,
  score_delta INT NOT NULL,
  score_after INT NOT NULL,
  reason VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reliability_member FOREIGN KEY (member_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_reliability_chit FOREIGN KEY (chit_id) REFERENCES chits(chit_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  reset_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  channel ENUM('EMAIL', 'PHONE') NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_from_ip VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_token_hash (token_hash),
  CONSTRAINT fk_reset_tokens_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_kyc (
  kyc_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL UNIQUE,
  pan_number_masked VARCHAR(20) NULL,
  pan_number_hash VARCHAR(64) NULL,
  aadhaar_number_masked VARCHAR(20) NOT NULL,
  aadhaar_number_hash VARCHAR(64) NOT NULL,
  id_document_path VARCHAR(255) NULL,
  verification_provider VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
  provider_reference_id VARCHAR(100) NULL,
  reason_code VARCHAR(100) NULL,
  status ENUM('NOT_STARTED', 'IN_PROGRESS', 'VERIFIED', 'REVIEW_REQUIRED', 'REJECTED') NOT NULL DEFAULT 'NOT_STARTED',
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

CREATE TABLE IF NOT EXISTS user_kyc_history (
  history_id INT PRIMARY KEY AUTO_INCREMENT,
  kyc_id INT NOT NULL,
  user_id INT NOT NULL,
  action_type ENUM('SUBMITTED', 'VERIFIED', 'REJECTED', 'RESUBMITTED', 'REVIEW_REQUIRED') NOT NULL,
  status ENUM('NOT_STARTED', 'IN_PROGRESS', 'VERIFIED', 'REVIEW_REQUIRED', 'REJECTED') NOT NULL,
  rejection_reason VARCHAR(255) NULL,
  performed_by INT NOT NULL,
  performed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_kyc_hist_user (user_id),
  CONSTRAINT fk_kyc_hist_kyc FOREIGN KEY (kyc_id) REFERENCES user_kyc(kyc_id) ON DELETE RESTRICT,
  CONSTRAINT fk_kyc_hist_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_kyc_hist_actor FOREIGN KEY (performed_by) REFERENCES users(user_id) ON DELETE RESTRICT
);

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

CREATE TABLE IF NOT EXISTS system_fee_configs (
  config_id INT PRIMARY KEY AUTO_INCREMENT,
  plan_name VARCHAR(80) NOT NULL,
  rate_per_month DECIMAL(10, 2) NOT NULL DEFAULT 199.00,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

