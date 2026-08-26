const { roundCurrency } = require("./chitCalculations");

const COUNTED_MEMBER_STATUSES = ["JOINED", "ACTIVE", "PAID_CURRENT", "DEFAULTER", "COMPLETED"];
const AUCTION_MEMBER_STATUSES = ["ACTIVE", "PAID_CURRENT"];

const statusPlaceholders = (statuses) => statuses.map(() => "?").join(", ");

const getMinimumMembersRequired = (chit) => {
  const configured = Number(chit.minimum_members_required || 0);
  return configured > 0 ? configured : Number(chit.total_members || 0);
};

const getMinimumCollectionRequired = (chit) => {
  const configured = Number(chit.minimum_collection_required || 0);
  if (configured > 0) {
    return roundCurrency(configured);
  }

  return roundCurrency(getMinimumMembersRequired(chit) * Number(chit.monthly_installment || 0));
};

const buildMonthlyPoolSnapshot = async (db, chit, installmentNumber) => {
  const installment = Number(installmentNumber);
  const [paidRows] = await db.query(
    `
      SELECT
        p.member_id,
        p.amount_paid,
        p.amount_due,
        cm.status,
        cm.has_won_auction
      FROM payments p
      JOIN chit_members cm
        ON cm.chit_id = p.chit_id
       AND cm.member_id = p.member_id
      WHERE p.chit_id = ?
        AND p.installment_number = ?
        AND p.payment_status IN ('PAID_ON_TIME', 'LATE_PAYMENT')
        AND cm.status IN (${statusPlaceholders(COUNTED_MEMBER_STATUSES)})
    `,
    [chit.chit_id, installment, ...COUNTED_MEMBER_STATUSES]
  );

  const [[memberCounts]] = await db.query(
    `
      SELECT
        COUNT(*) AS joined_member_count,
        SUM(CASE WHEN status IN (${statusPlaceholders(AUCTION_MEMBER_STATUSES)}) THEN 1 ELSE 0 END)
          AS active_member_count
      FROM chit_members
      WHERE chit_id = ?
        AND status IN (${statusPlaceholders(COUNTED_MEMBER_STATUSES)})
    `,
    [...AUCTION_MEMBER_STATUSES, chit.chit_id, ...COUNTED_MEMBER_STATUSES]
  );

  const poolAmount = roundCurrency(
    paidRows.reduce((total, row) => total + Number(row.amount_paid || 0), 0)
  );
  const paidMemberIds = [...new Set(paidRows.map((row) => Number(row.member_id)))];
  const paidMemberCount = paidMemberIds.length;
  const joinedMemberCount = Number(memberCounts?.joined_member_count || 0);
  const activeMemberCount = Number(memberCounts?.active_member_count || 0);
  const expectedAmount = roundCurrency(joinedMemberCount * Number(chit.monthly_installment || 0));
  const minimumMembersRequired = getMinimumMembersRequired(chit);
  const minimumCollectionRequired = getMinimumCollectionRequired(chit);
  const pendingInstallmentAmount = roundCurrency(Math.max(0, expectedAmount - poolAmount));
  const isReady =
    paidMemberCount >= minimumMembersRequired && poolAmount >= minimumCollectionRequired;

  return {
    chit_id: Number(chit.chit_id),
    installment_number: installment,
    expectedAmount,
    poolAmount,
    paidMemberCount,
    paidMemberIds,
    joinedMemberCount,
    activeMemberCount,
    minimumMembersRequired,
    minimumCollectionRequired,
    pendingInstallmentAmount,
    status: isReady ? "READY" : "COLLECTING",
    isReady,
  };
};

const upsertMonthlyPool = async (db, chit, installmentNumber) => {
  const snapshot = await buildMonthlyPoolSnapshot(db, chit, installmentNumber);

  await db.query(
    `
      INSERT INTO monthly_pools (
        chit_id,
        installment_number,
        expected_amount,
        pool_amount,
        paid_member_count,
        required_member_count,
        minimum_collection_required,
        pending_installment_amount,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        expected_amount = VALUES(expected_amount),
        pool_amount = VALUES(pool_amount),
        paid_member_count = VALUES(paid_member_count),
        required_member_count = VALUES(required_member_count),
        minimum_collection_required = VALUES(minimum_collection_required),
        pending_installment_amount = VALUES(pending_installment_amount),
        status = CASE
          WHEN status IN ('LOCKED', 'SETTLED', 'CANCELLED') THEN status
          ELSE VALUES(status)
        END,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      snapshot.chit_id,
      snapshot.installment_number,
      snapshot.expectedAmount,
      snapshot.poolAmount,
      snapshot.paidMemberCount,
      snapshot.minimumMembersRequired,
      snapshot.minimumCollectionRequired,
      snapshot.pendingInstallmentAmount,
      snapshot.status,
    ]
  );

  const [[pool]] = await db.query(
    "SELECT * FROM monthly_pools WHERE chit_id = ? AND installment_number = ?",
    [snapshot.chit_id, snapshot.installment_number]
  );

  return {
    ...snapshot,
    pool,
  };
};

const getPaidEligibleMembers = async (db, chitId, installmentNumber, excludedMemberId = null) => {
  let exclusionClause = "";

  if (excludedMemberId) {
    exclusionClause = "AND cm.member_id <> ?";
    params.push(Number(excludedMemberId));
  }

  const [members] = await db.query(
    `
      SELECT DISTINCT
        cm.member_id,
        w.wallet_id
      FROM chit_members cm
      JOIN payments p
        ON p.chit_id = cm.chit_id
       AND p.member_id = cm.member_id
       AND p.installment_number = ?
       AND p.payment_status IN ('PAID_ON_TIME', 'LATE_PAYMENT')
      JOIN wallets w ON w.user_id = cm.member_id
      WHERE cm.chit_id = ?
        AND cm.status IN (${statusPlaceholders(AUCTION_MEMBER_STATUSES)})
        ${exclusionClause}
      ORDER BY cm.member_id ASC
    `,
    [Number(installmentNumber), chitId, ...AUCTION_MEMBER_STATUSES, ...(excludedMemberId ? [Number(excludedMemberId)] : [])]
  );

  return members;
};

module.exports = {
  COUNTED_MEMBER_STATUSES,
  AUCTION_MEMBER_STATUSES,
  getMinimumMembersRequired,
  getMinimumCollectionRequired,
  buildMonthlyPoolSnapshot,
  upsertMonthlyPool,
  getPaidEligibleMembers,
};
