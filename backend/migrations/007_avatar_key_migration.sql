-- Migration 007: Make avatar_key the single canonical column in users table

-- 1. Add avatar_key if it does not exist
SET @dbname = DATABASE();
SET @tablename = 'users';
SET @columnname = 'avatar_key';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN avatar_key VARCHAR(255) NULL'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 2. If legacy avatar_url column exists, migrate non-null values to avatar_key if avatar_key is null, then drop avatar_url
SET @columnname_old = 'avatar_url';
SET @preparedStatementOld = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname_old
  ) > 0,
  'UPDATE users SET avatar_key = avatar_url WHERE avatar_key IS NULL AND avatar_url IS NOT NULL; ALTER TABLE users DROP COLUMN avatar_url;',
  'SELECT 1'
));
PREPARE alterOldColumn FROM @preparedStatementOld;
EXECUTE alterOldColumn;
DEALLOCATE PREPARE alterOldColumn;
