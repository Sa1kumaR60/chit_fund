const cron = require('node-cron');
const db = require('../db');
const { COUNTED_MEMBER_STATUSES } = require('../utils/monthlyPools');

const dbPromise = db.promise();
const countedMemberPlaceholders = COUNTED_MEMBER_STATUSES.map(() => "?").join(", ");

// Run every day at 8:00 AM
const initCronJobs = () => {
  cron.schedule('0 8 * * *', async () => {
    console.log('Running daily cron jobs for Reminders and Monthly Reports');
    try {
      await sendPaymentReminders();
      await checkAndApplyLatePenalties();
      await cleanupExpiredResetTokens();
      // On the 1st of every month, generate previous month's report
      const today = new Date();
      if (today.getDate() === 1) {
        await generateMonthlyReports();
      }
    } catch (error) {
      console.error('Error running cron jobs:', error);
    }
  });
};

const cleanupExpiredResetTokens = async () => {
  try {
    const [res] = await dbPromise.query(
      "DELETE FROM password_reset_tokens WHERE expires_at < NOW() - INTERVAL 1 DAY OR used_at IS NOT NULL"
    );
    if (res.affectedRows > 0) {
      console.log(`Cleaned up ${res.affectedRows} expired password reset tokens.`);
    }
  } catch (err) {
    console.error("Error cleaning up reset tokens:", err);
  }
};

const sendPaymentReminders = async () => {
  // Logic to send reminders 7 days, 3 days, 1 day before due date
  // Since due dates depend on the start date + installment number, we check active chits
  const [chits] = await dbPromise.query("SELECT * FROM chits WHERE status = 'ACTIVE'");
  
  for (const chit of chits) {
    const today = new Date();
    // Simplified logic: If today's day of the month is approaching chit.monthly_due_date
    // E.g., due date = 5th. Today = 28th (approx 7 days before).
    const dueDay = chit.monthly_due_date;
    const currentDay = today.getDate();
    
    // Quick calculation for days until due (assuming same month or next month)
    let daysUntilDue = dueDay - currentDay;
    if (daysUntilDue < 0) {
      // Due next month
      const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      daysUntilDue = (daysInMonth - currentDay) + dueDay;
    }

    if ([7, 3, 1, 0].includes(daysUntilDue)) {
      let message = `Reminder: Your monthly chit installment of Rs.${chit.monthly_installment} for ${chit.group_name} is due in ${daysUntilDue} days.`;
      if (daysUntilDue === 0) {
        message = `Urgent: Your monthly chit installment of Rs.${chit.monthly_installment} for ${chit.group_name} is due TODAY.`;
      }
      
      const [members] = await dbPromise.query(
        `SELECT member_id FROM chit_members WHERE chit_id = ? AND status IN (${countedMemberPlaceholders})`,
        [chit.chit_id, ...COUNTED_MEMBER_STATUSES]
      );
      
      for (const member of members) {
        await dbPromise.query(
          "INSERT INTO notifications (user_id, type, message) VALUES (?, 'REMINDER', ?)",
          [member.member_id, message]
        );
      }
    }
  }
};

const checkAndApplyLatePenalties = async () => {
  const [chits] = await dbPromise.query("SELECT * FROM chits WHERE status = 'ACTIVE'");
  const today = new Date();
  const currentDay = today.getDate();

  for (const chit of chits) {
    const dueDay = chit.monthly_due_date;
    const gracePeriod = chit.grace_period_days;
    
    // If today is exactly dueDay + gracePeriod + 1, they just crossed the line
    let thresholdDay = dueDay + gracePeriod + 1;
    if (thresholdDay > 28) thresholdDay = 28; // Simplified for month bounds

    if (currentDay === thresholdDay) {
      // Find members who haven't paid this month's installment yet
      // We deduct -10 for skipping/crossing grace period entirely.
      console.log(`Applying skipped month penalty (-10) for chit ${chit.chit_id} on threshold day ${thresholdDay}`);
      
      const [members] = await dbPromise.query(
        "SELECT member_id FROM chit_members WHERE chit_id = ? AND status = 'DEFAULTER'", 
        [chit.chit_id]
      );
      
      for (const member of members) {
        await dbPromise.query(
          "UPDATE users SET merit_score = GREATEST(0, merit_score - 10) WHERE user_id = ?",
          [member.member_id]
        );
        // We do NOT kick them out when it hits 0 based on user feedback, just record it.
      }
    }
  }
};

const generateMonthlyReports = async () => {
  const [chits] = await dbPromise.query("SELECT * FROM chits WHERE status != 'CANCELLED'");
  
  for (const chit of chits) {
    const previousMonth = new Date().getMonth() || 12; // 1-12
    const [[pool]] = await dbPromise.query(
      `
        SELECT
          pool_amount,
          pending_installment_amount,
          paid_member_count
        FROM monthly_pools
        WHERE chit_id = ? AND installment_number = ?
      `,
      [chit.chit_id, previousMonth]
    );

    const paidCount = Number(pool?.paid_member_count || 0);
    const unpaidCount = Math.max(0, Number(chit.total_members || 0) - paidCount);
    
    await dbPromise.query(
      `INSERT INTO monthly_reports (chit_id, month_number, collected_amount, pending_amount, paid_count, unpaid_count) 
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         collected_amount = VALUES(collected_amount),
         pending_amount = VALUES(pending_amount),
         paid_count = VALUES(paid_count),
         unpaid_count = VALUES(unpaid_count)`,
      [
        chit.chit_id,
        previousMonth,
        Number(pool?.pool_amount || 0),
        Number(pool?.pending_installment_amount || 0),
        paidCount,
        unpaidCount,
      ]
    );
  }
};

module.exports = {
  initCronJobs
};
