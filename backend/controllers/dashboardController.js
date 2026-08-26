const db = require("../db");
const { getMemberFinancialSummary } = require("../utils/memberFinance");

const dbPromise = db.promise();

const getAdminDashboard = async (req, res) => {
  try {
    const adminId = req.user?.id;

    if (!adminId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Only admins can view this dashboard" });
    }

    const [chits] = await dbPromise.query(
      `
        SELECT
          c.*,
          COUNT(DISTINCT cm.member_id) AS joined_members,
          COUNT(DISTINCT CASE WHEN cm.status = 'DEFAULTER' THEN cm.member_id END) AS defaulter_count,
          COUNT(DISTINCT CASE WHEN p.payment_status = 'PAID_ON_TIME' THEN p.payment_id END) AS on_time_payments,
          COUNT(DISTINCT CASE WHEN p.payment_status = 'LATE_PAYMENT' THEN p.payment_id END) AS late_payments
        FROM chits c
        LEFT JOIN chit_members cm ON cm.chit_id = c.chit_id
        LEFT JOIN payments p ON p.chit_id = c.chit_id
        WHERE c.admin_id = ?
        GROUP BY c.chit_id
        ORDER BY c.start_date DESC
      `,
      [adminId]
    );

    const [openAuctions] = await dbPromise.query(
      `
        SELECT a.*, c.chit_value
        FROM auctions a
        JOIN chits c ON c.chit_id = a.chit_id
        WHERE c.admin_id = ? AND a.status = 'OPEN'
        ORDER BY a.started_at DESC
      `,
      [adminId]
    );

    const [defaulters] = await dbPromise.query(
      `
        SELECT
          cm.chit_id,
          cm.member_id,
          cm.unpaid_streak,
          u.name,
          u.phone
        FROM chit_members cm
        JOIN chits c ON c.chit_id = cm.chit_id
        JOIN users u ON u.user_id = cm.member_id
        WHERE c.admin_id = ? AND cm.status = 'DEFAULTER'
        ORDER BY cm.unpaid_streak DESC, u.name ASC
      `,
      [adminId]
    );

    const [[finance]] = await dbPromise.query(
      `
        SELECT
          COALESCE(SUM(mp.pool_amount), 0) AS total_collected,
          COALESCE(SUM(
            CASE
              WHEN mp.status = 'SETTLED' THEN mp.winner_payout
              WHEN mp.status = 'LOCKED' THEN GREATEST(0, mp.pool_amount - mp.commission_amount - mp.reserve_amount)
              ELSE 0
            END
          ), 0) AS locked_auction_amount,
          COALESCE(SUM(mp.reserve_amount), 0) AS reserve_fund,
          COALESCE(SUM(mp.commission_amount), 0) AS commission_earned,
          COALESCE(SUM(mp.pending_installment_amount), 0) AS pending_installments
        FROM monthly_pools mp
        JOIN chits c ON c.chit_id = mp.chit_id
        WHERE c.admin_id = ?
      `,
      [adminId]
    );

    const [[adminWallet]] = await dbPromise.query(
      "SELECT balance FROM wallets WHERE user_id = ?",
      [adminId]
    );

    const totals = chits.reduce(
      (accumulator, chit) => {
        accumulator.totalChits += 1;
        accumulator.totalMembers += Number(chit.joined_members || 0);
        accumulator.totalDefaulters += Number(chit.defaulter_count || 0);
        accumulator.totalLatePayments += Number(chit.late_payments || 0);
        return accumulator;
      },
      {
        totalChits: 0,
        totalMembers: 0,
        totalDefaulters: 0,
        totalLatePayments: 0,
      }
    );

    return res.status(200).json({
      totals,
      finance: {
        total_collected: Number(finance?.total_collected || 0),
        locked_auction_amount: Number(finance?.locked_auction_amount || 0),
        reserve_fund: Number(finance?.reserve_fund || 0),
        commission_earned: Number(finance?.commission_earned || 0),
        pending_installments: Number(finance?.pending_installments || 0),
        available_balance: Number(adminWallet?.balance || 0),
      },
      chits,
      open_auctions: openAuctions,
      defaulters,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getMemberDashboard = async (req, res) => {
  try {
    const memberId = req.user?.id;

    if (!memberId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (req.user.role !== "MEMBER") {
      return res.status(403).json({ message: "Only members can view this dashboard" });
    }

    const [memberships] = await dbPromise.query(
      `
        SELECT
          c.*,
          cm.status AS membership_status,
          cm.unpaid_streak,
          cm.has_won_auction,
          u.name AS admin_name
        FROM chit_members cm
        JOIN chits c ON c.chit_id = cm.chit_id
        JOIN users u ON u.user_id = c.admin_id
        WHERE cm.member_id = ?
        ORDER BY c.start_date DESC
      `,
      [memberId]
    );

    const enrichedMemberships = [];

    for (const membership of memberships) {
      const summary = await getMemberFinancialSummary(dbPromise, membership, memberId);
      enrichedMemberships.push({
        ...membership,
        summary,
      });
    }

    const [openAuctions] = await dbPromise.query(
      `
        SELECT
          a.*,
          c.chit_value,
          c.total_members,
          c.admin_commission_rate
        FROM auctions a
        JOIN chit_members cm ON cm.chit_id = a.chit_id
        JOIN chits c ON c.chit_id = a.chit_id
        WHERE cm.member_id = ? AND a.status = 'OPEN'
        ORDER BY a.started_at DESC
      `,
      [memberId]
    );

    const totals = enrichedMemberships.reduce(
      (accumulator, membership) => {
        accumulator.joinedChits += 1;
        accumulator.pendingDues += Number(membership.summary.pendingDues || 0);
        accumulator.penaltyTotal += Number(membership.summary.penaltyTotal || 0);
        accumulator.activeDefaulters += membership.summary.isDefaulter ? 1 : 0;
        return accumulator;
      },
      {
        joinedChits: 0,
        pendingDues: 0,
        penaltyTotal: 0,
        activeDefaulters: 0,
      }
    );

    const [[userProfile]] = await dbPromise.query("SELECT user_id, name, merit_score FROM users WHERE user_id = ?", [memberId]);

    return res.status(200).json({
      totals,
      memberships: enrichedMemberships,
      open_auctions: openAuctions,
      user_profile: userProfile,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getMonthlyReports = async (req, res) => {
  try {
    const adminId = req.user?.id;

    if (!adminId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Only admins can view monthly reports" });
    }

    const [reports] = await dbPromise.query(
      `
        SELECT 
          mr.*,
          c.group_name,
          c.chit_value,
          c.monthly_installment
        FROM monthly_reports mr
        JOIN chits c ON c.chit_id = mr.chit_id
        WHERE c.admin_id = ?
        ORDER BY mr.created_at DESC
      `,
      [adminId]
    );

    return res.status(200).json(reports);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAdminDashboard,
  getMemberDashboard,
  getMonthlyReports,
};
