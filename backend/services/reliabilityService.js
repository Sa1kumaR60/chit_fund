const db = require('../db');

/**
 * Service to manage Member Reliability Scores (+3 early, +2 on-time, -5 late, -10 missed, -25 default)
 */

async function updateMemberReliabilityScore({ memberId, chitId = null, eventType, customReason = null }) {
  let scoreDelta = 0;
  let reason = customReason;

  switch (eventType) {
    case 'EARLY_PAYMENT':
      scoreDelta = 3;
      reason = reason || 'Payment completed >= 3 days before due date';
      break;
    case 'ON_TIME_PAYMENT':
      scoreDelta = 2;
      reason = reason || 'Payment completed on or before due date';
      break;
    case 'LATE_PAYMENT':
      scoreDelta = -5;
      reason = reason || 'Payment completed during grace period';
      break;
    case 'MISSED_PAYMENT':
      scoreDelta = -10;
      reason = reason || 'Payment missed (grace period expired)';
      break;
    case 'DEFAULTED':
      scoreDelta = -25;
      reason = reason || 'Declared defaulter due to repeated missed payments';
      break;
    default:
      return;
  }

  // Fetch current score
  const [users] = await db.promise().query(
    `SELECT merit_score FROM users WHERE user_id = ?`,
    [memberId]
  );

  if (!users || users.length === 0) return;

  let currentScore = users[0].merit_score || 100;
  let newScore = Math.max(0, currentScore + scoreDelta);

  // Update user merit_score
  await db.promise().query(
    `UPDATE users SET merit_score = ? WHERE user_id = ?`,
    [newScore, memberId]
  );

  // Insert log in member_reliability_history
  await db.promise().query(
    `INSERT INTO member_reliability_history (member_id, chit_id, event_type, score_delta, score_after, reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [memberId, chitId, eventType, scoreDelta, newScore, reason]
  );

  // Check if member should be marked DEFAULTED in chit_members if missed counts exceed limit
  if (chitId && eventType === 'MISSED_PAYMENT') {
    const [cm] = await db.promise().query(
      `SELECT chit_member_id, unpaid_streak, total_missed_count FROM chit_members WHERE chit_id = ? AND member_id = ?`,
      [chitId, memberId]
    );

    if (cm && cm.length > 0) {
      const newStreak = (cm[0].unpaid_streak || 0) + 1;
      const newMissedTotal = (cm[0].total_missed_count || 0) + 1;

      let newStatus = 'LATE_PAYMENT';
      if (newStreak >= 2 || newMissedTotal >= 3) {
        newStatus = 'DEFAULTED';
        // Apply default penalty score update if entering DEFAULTED status for first time
        await updateMemberReliabilityScore({
          memberId,
          chitId,
          eventType: 'DEFAULTED',
          customReason: `Missed ${newStreak} consecutive or ${newMissedTotal} total installments.`,
        });
      }

      await db.promise().query(
        `UPDATE chit_members SET unpaid_streak = ?, total_missed_count = ?, status = ? WHERE chit_id = ? AND member_id = ?`,
        [newStreak, newMissedTotal, newStatus, chitId, memberId]
      );
    }
  }

  return { newScore, scoreDelta };
}

module.exports = {
  updateMemberReliabilityScore,
};
