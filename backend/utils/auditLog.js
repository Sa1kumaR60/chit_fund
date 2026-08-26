const dbPool = require("../db");

const recordAuditLog = async (
  db,
  { userId = null, actionType, referenceType = "SYSTEM", referenceId = null, details = {} }
) => {
  const connection = db || dbPool.promise();
  await connection.query(
    `
      INSERT INTO audit_logs (
        user_id,
        action_type,
        reference_type,
        reference_id,
        details
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      userId,
      actionType,
      referenceType,
      referenceId,
      JSON.stringify(details),
    ]
  );
};

const record = async ({ userId = null, actionType, referenceType = "SYSTEM", referenceId = null, details = {} }) => {
  return recordAuditLog(dbPool.promise(), { userId, actionType, referenceType, referenceId, details });
};

module.exports = {
  recordAuditLog,
  record,
};
