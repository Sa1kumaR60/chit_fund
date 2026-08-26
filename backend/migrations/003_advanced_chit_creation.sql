-- Migration 003: Advanced Chit Creation Logic & Rule Engine Schema

-- 1. Create chit_monthly_rules table
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

-- 2. Create chit_member_slots table
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

-- 3. Create member_reliability_history table
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
