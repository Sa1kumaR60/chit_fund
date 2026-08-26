-- Cash-flow-safe auction upgrade.
-- Run this after 001_upgrade_chits_table.sql on existing databases.

ALTER TABLE chits
  ADD COLUMN minimum_members_required INT NULL AFTER total_members,
  ADD COLUMN minimum_collection_required DECIMAL(12, 2) NULL AFTER minimum_members_required,
  ADD COLUMN reserve_rate DECIMAL(5, 4) NOT NULL DEFAULT 0.0200 AFTER admin_commission_rate;

UPDATE chits
SET
  minimum_members_required = COALESCE(minimum_members_required, total_members),
  minimum_collection_required = COALESCE(minimum_collection_required, total_members * monthly_installment)
WHERE minimum_members_required IS NULL
   OR minimum_collection_required IS NULL;

ALTER TABLE chits
  MODIFY COLUMN minimum_members_required INT NOT NULL,
  MODIFY COLUMN minimum_collection_required DECIMAL(12, 2) NOT NULL;

ALTER TABLE chit_members
  MODIFY COLUMN status ENUM('JOINED', 'ACTIVE', 'PAID_CURRENT', 'DEFAULTER', 'COMPLETED', 'LEFT') NOT NULL DEFAULT 'JOINED';

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
  CONSTRAINT fk_monthly_pools_chit FOREIGN KEY (chit_id) REFERENCES chits(chit_id),
  CONSTRAINT fk_monthly_pools_winner FOREIGN KEY (auction_winner_id) REFERENCES users(user_id),
  CONSTRAINT fk_monthly_pools_approver FOREIGN KEY (approved_by) REFERENCES users(user_id)
);

ALTER TABLE auctions
  ADD COLUMN pool_id INT NULL AFTER installment_number,
  ADD COLUMN pool_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER pool_id,
  ADD COLUMN paid_member_count INT NOT NULL DEFAULT 0 AFTER pool_amount,
  ADD COLUMN reserve_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER admin_commission_amount,
  ADD COLUMN distributed_discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER distribution_per_member,
  ADD COLUMN eligible_dividend_count INT NOT NULL DEFAULT 0 AFTER distributed_discount_amount,
  ADD COLUMN manually_approved_partial TINYINT(1) NOT NULL DEFAULT 0 AFTER eligible_dividend_count,
  ADD CONSTRAINT fk_auctions_pool FOREIGN KEY (pool_id) REFERENCES monthly_pools(pool_id);

ALTER TABLE transactions
  MODIFY COLUMN type ENUM('DEPOSIT', 'WITHDRAWAL', 'INSTALLMENT_PAYMENT', 'AUCTION_WINNING', 'DIVIDEND', 'LATE_FEE', 'COMMISSION', 'RESERVE', 'ADJUSTMENT') NOT NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NULL,
  action_type VARCHAR(80) NOT NULL,
  reference_type VARCHAR(40) NOT NULL DEFAULT 'SYSTEM',
  reference_id INT NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users(user_id)
);
