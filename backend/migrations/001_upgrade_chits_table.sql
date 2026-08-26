-- Run this once against your existing database if the old `chits` table
-- still uses `total_amount` instead of `chit_value`.

ALTER TABLE chits
  CHANGE COLUMN total_amount chit_value DECIMAL(12, 2) NOT NULL;

ALTER TABLE chits
  ADD COLUMN end_date DATE NULL AFTER start_date,
  ADD COLUMN total_members INT NULL AFTER duration_months,
  ADD COLUMN late_fee_rate DECIMAL(5, 4) NOT NULL DEFAULT 0.0200 AFTER monthly_installment,
  ADD COLUMN admin_commission_rate DECIMAL(5, 4) NOT NULL DEFAULT 0.0500 AFTER late_fee_rate;

UPDATE chits
SET end_date = DATE_ADD(start_date, INTERVAL duration_months MONTH)
WHERE end_date IS NULL;

-- Set this to the correct member count for each existing chit if you already
-- have production data. This default is only to unblock development.
UPDATE chits
SET total_members = duration_months
WHERE total_members IS NULL;

ALTER TABLE chits
  MODIFY COLUMN end_date DATE NOT NULL,
  MODIFY COLUMN total_members INT NOT NULL;
