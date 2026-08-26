const db = require('../db');
const auditLog = require('../utils/auditLog');

/**
 * Validates and triggers Chit Lifecycle State Transitions
 */

const VALID_TRANSITIONS = {
  DRAFT: ['WAITING_CONFIG', 'WAITING_MEMBERS', 'CANCELLED'],
  WAITING_CONFIG: ['WAITING_MEMBERS', 'CANCELLED'],
  WAITING_MEMBERS: ['READY_TO_START', 'CANCELLED'],
  READY_TO_START: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['AUCTION_RUNNING', 'PAYMENT_COLLECTION', 'COMPLETED', 'CLOSED'],
  AUCTION_RUNNING: ['PAYMENT_COLLECTION', 'ACTIVE', 'CANCELLED'],
  PAYMENT_COLLECTION: ['ACTIVE', 'AUCTION_RUNNING', 'COMPLETED'],
  COMPLETED: ['CLOSED'],
  CLOSED: [],
};

async function transitionChitStatus(chitId, newStatus, adminUserId, details = {}) {
  const [chits] = await db.promise().query(
    `SELECT chit_id, group_name, status, total_members FROM chits WHERE chit_id = ?`,
    [chitId]
  );

  if (!chits || chits.length === 0) {
    throw new Error('Chit group not found.');
  }

  const chit = chits[0];
  const currentStatus = chit.status;

  const allowed = VALID_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid status transition from ${currentStatus} to ${newStatus}.`);
  }

  // Verification checks for READY_TO_START
  if (newStatus === 'READY_TO_START') {
    const [members] = await db.promise().query(
      `SELECT COUNT(*) as count FROM chit_members WHERE chit_id = ? AND status IN ('ACCEPTED', 'VERIFIED', 'ACTIVE')`,
      [chitId]
    );

    if (members[0].count < chit.total_members) {
      throw new Error(`Cannot set chit to READY_TO_START. Accepted members (${members[0].count}) is less than total required members (${chit.total_members}).`);
    }
  }

  // Update DB status
  await db.promise().query(
    `UPDATE chits SET status = ? WHERE chit_id = ?`,
    [newStatus, chitId]
  );

  // Record audit log
  await auditLog.record({
    userId: adminUserId,
    actionType: 'CHIT_STATUS_TRANSITION',
    referenceType: 'CHIT',
    referenceId: chitId,
    details: {
      fromStatus: currentStatus,
      toStatus: newStatus,
      ...details,
    },
  });

  return { chitId, previousStatus: currentStatus, newStatus };
}

module.exports = {
  transitionChitStatus,
  VALID_TRANSITIONS,
};
