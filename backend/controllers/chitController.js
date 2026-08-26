const db = require("../db");
const crypto = require("crypto");
const {
  generateFinancialSimulation,
  calculateFixedChitSchedule,
} = require("../services/ruleEngine");
const { transitionChitStatus } = require("../services/chitLifecycle");
const auditLog = require("../utils/auditLog");

const dbPromise = db.promise();

/**
 * Step 1: Create Basic Chit Information (Status: DRAFT)
 */
const createWizardChit = async (req, res) => {
  try {
    const adminId = req.user?.id;
    if (!adminId || req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Only admins can create chit groups" });
    }

    const {
      group_name,
      type = "FIXED",
      chit_value,
      start_date,
      duration_months,
      total_members,
      monthly_due_date = 5,
      grace_period_days = 5,
      description,
      auction_method = "HIGHEST_DISCOUNT",
      max_discount_allowed,
      min_bid_amount,
      auction_start_time = "10:00",
      auction_end_time = "18:00",
      commission_payout_timing = "MONTHLY",
      admin_commission_rate = 0.05,
      late_fee_rate = 0.02,
    } = req.body;

    if (!chit_value || !start_date || !duration_months || !total_members) {
      return res.status(400).json({
        message: "chit_value, start_date, duration_months, and total_members are required",
      });
    }

    const chitValue = Number(chit_value);
    const durationMonths = Number(duration_months);
    const totalMembers = Number(total_members);

    // Compute end date (months addition)
    const startDateObj = new Date(start_date);
    const endDateObj = new Date(startDateObj);
    endDateObj.setMonth(endDateObj.getMonth() + durationMonths);
    const endDateStr = endDateObj.toISOString().split("T")[0];

    const monthlyInstallment = Number((chitValue / durationMonths).toFixed(2));

    const [result] = await dbPromise.query(
      `
        INSERT INTO chits (
          group_name,
          admin_id,
          type,
          status,
          chit_value,
          start_date,
          end_date,
          monthly_due_date,
          grace_period_days,
          duration_months,
          total_members,
          minimum_members_required,
          minimum_collection_required,
          monthly_installment,
          late_fee_rate,
          admin_commission_rate,
          description,
          auction_method,
          max_discount_allowed,
          min_bid_amount,
          auction_start_time,
          auction_end_time,
          commission_payout_timing
        )
        VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        group_name || "Unnamed Chit Group",
        adminId,
        type,
        chitValue,
        start_date,
        endDateStr,
        monthly_due_date,
        grace_period_days,
        durationMonths,
        totalMembers,
        totalMembers,
        chitValue,
        monthlyInstallment,
        late_fee_rate,
        admin_commission_rate,
        description || null,
        type === "AUCTION" ? auction_method : null,
        max_discount_allowed ? Number(max_discount_allowed) : null,
        min_bid_amount ? Number(min_bid_amount) : null,
        auction_start_time,
        auction_end_time,
        commission_payout_timing,
      ]
    );

    const chitId = result.insertId;

    await auditLog.record({
      userId: adminId,
      actionType: "CHIT_CREATED_DRAFT",
      referenceType: "CHIT",
      referenceId: chitId,
      details: { group_name, type, chitValue, totalMembers, durationMonths },
    });

    return res.status(201).json({
      message: "Chit draft created successfully",
      chit_id: chitId,
      status: "DRAFT",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/**
 * Step 2: Configure Monthly Financial & Auction Rules
 */
const saveMonthlyRules = async (req, res) => {
  try {
    const adminId = req.user?.id;
    const { chitId } = req.params;
    const { monthly_rules = [] } = req.body;

    if (!adminId || req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Only admins can configure rules" });
    }

    const [[chit]] = await dbPromise.query("SELECT * FROM chits WHERE chit_id = ?", [chitId]);
    if (!chit) return res.status(404).json({ message: "Chit not found" });
    if (Number(chit.admin_id) !== Number(adminId)) {
      return res.status(403).json({ message: "You do not manage this chit group" });
    }

    // Clear existing monthly rules for this chit
    await dbPromise.query("DELETE FROM chit_monthly_rules WHERE chit_id = ?", [chitId]);

    // Insert new rules
    for (const rule of monthly_rules) {
      await dbPromise.query(
        `
          INSERT INTO chit_monthly_rules (
            chit_id,
            month_number,
            fixed_installment_amount,
            winner_pays_amount,
            non_winner_pays_amount,
            min_discount,
            max_discount,
            commission_rate,
            penalty_rate
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          chitId,
          rule.month_number,
          rule.fixed_installment_amount || chit.monthly_installment,
          rule.winner_pays_amount || null,
          rule.non_winner_pays_amount || null,
          rule.min_discount || null,
          rule.max_discount || null,
          rule.commission_rate || chit.admin_commission_rate,
          rule.penalty_rate || chit.late_fee_rate,
        ]
      );
    }

    await dbPromise.query("UPDATE chits SET status = 'WAITING_CONFIG' WHERE chit_id = ?", [chitId]);

    return res.status(200).json({ message: "Monthly rules configured successfully", chit_id: chitId });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/**
 * Step 3: Configure Member Slots (Fixed Chits: Payout Months 1..N) & Issue Invitations
 */
const configureMemberSlots = async (req, res) => {
  try {
    const adminId = req.user?.id;
    const { chitId } = req.params;
    const { slots = [], invitees = [] } = req.body;

    if (!adminId || req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Only admins can configure member slots" });
    }

    const [[chit]] = await dbPromise.query("SELECT * FROM chits WHERE chit_id = ?", [chitId]);
    if (!chit) return res.status(404).json({ message: "Chit not found" });

    if (chit.type === "FIXED") {
      // Validate slot assignments
      if (slots.length !== chit.total_members) {
        return res.status(400).json({
          message: `Exactly ${chit.total_members} slots must be configured for this Fixed Chit group.`,
        });
      }

      // Check unique assigned months 1..N
      const assignedMonths = new Set(slots.map((s) => Number(s.assigned_month)));
      if (assignedMonths.size !== chit.total_members) {
        return res.status(400).json({ message: "Each month 1..N must be assigned to exactly one member slot." });
      }

      await dbPromise.query("DELETE FROM chit_member_slots WHERE chit_id = ?", [chitId]);

      for (const slot of slots) {
        const inviteToken = crypto.randomBytes(24).toString("hex");
        const phone = slot.invitee_phone ? slot.invitee_phone.trim() : null;
        const email = slot.invitee_email ? slot.invitee_email.trim() : null;

        // Check if user exists by phone or email
        let matchedUserId = null;
        if (phone || email) {
          const [[user]] = await dbPromise.query(
            "SELECT user_id FROM users WHERE phone = ? OR email = ?",
            [phone || "", email || ""]
          );
          if (user) matchedUserId = user.user_id;
        }

        await dbPromise.query(
          `
            INSERT INTO chit_member_slots (
              chit_id,
              assigned_month,
              member_name,
              invitee_phone,
              invitee_email,
              member_id,
              invitation_token,
              status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'INVITED')
          `,
          [chitId, slot.assigned_month, slot.member_name || null, phone, email, matchedUserId, inviteToken]
        );

        // Also record in chit_invitations
        await dbPromise.query(
          `
            INSERT INTO chit_invitations (chit_id, user_id, invitee_phone, invitee_email, invitation_token, status)
            VALUES (?, ?, ?, ?, ?, 'PENDING')
          `,
          [chitId, matchedUserId, phone, email, inviteToken]
        );
      }
    } else {
      // AUCTION CHIT invite list
      for (const inv of invitees) {
        const inviteToken = crypto.randomBytes(24).toString("hex");
        const phone = inv.invitee_phone ? inv.invitee_phone.trim() : null;
        const email = inv.invitee_email ? inv.invitee_email.trim() : null;

        let matchedUserId = null;
        if (phone || email) {
          const [[user]] = await dbPromise.query(
            "SELECT user_id FROM users WHERE phone = ? OR email = ?",
            [phone || "", email || ""]
          );
          if (user) matchedUserId = user.user_id;
        }

        await dbPromise.query(
          `
            INSERT INTO chit_invitations (chit_id, user_id, invitee_phone, invitee_email, invitation_token, status)
            VALUES (?, ?, ?, ?, ?, 'PENDING')
          `,
          [chitId, matchedUserId, phone, email, inviteToken]
        );
      }
    }

    await dbPromise.query("UPDATE chits SET status = 'WAITING_MEMBERS' WHERE chit_id = ?", [chitId]);

    return res.status(200).json({
      message: "Member slots and invitations configured successfully",
      chit_id: chitId,
      status: "WAITING_MEMBERS",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/**
 * Step 5: Get Financial Simulation & Projection Preview for Admin Approval
 */
const getFinancialSimulationPreview = async (req, res) => {
  try {
    const { chitId } = req.params;
    const [[chit]] = await dbPromise.query("SELECT * FROM chits WHERE chit_id = ?", [chitId]);
    if (!chit) return res.status(404).json({ message: "Chit not found" });

    const [monthlyRules] = await dbPromise.query(
      "SELECT * FROM chit_monthly_rules WHERE chit_id = ? ORDER BY month_number ASC",
      [chitId]
    );

    const simulation = generateFinancialSimulation({
      type: chit.type,
      chitValue: chit.chit_value,
      durationMonths: chit.duration_months,
      totalMembers: chit.total_members,
      commissionRate: chit.admin_commission_rate,
      monthlyRules,
    });

    return res.status(200).json({ chit, simulation });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/**
 * Step 5: Final Activate Chit Group by Admin
 */
const activateChit = async (req, res) => {
  try {
    const adminId = req.user?.id;
    const { chitId } = req.params;

    if (!adminId || req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Only admins can activate chit groups" });
    }

    const [[chit]] = await dbPromise.query("SELECT * FROM chits WHERE chit_id = ?", [chitId]);
    if (!chit) return res.status(404).json({ message: "Chit not found" });

    // Transition state
    await dbPromise.query("UPDATE chits SET status = 'ACTIVE' WHERE chit_id = ?", [chitId]);

    await auditLog.record({
      userId: adminId,
      actionType: "CHIT_ACTIVATED",
      referenceType: "CHIT",
      referenceId: chitId,
      details: { group_name: chit.group_name },
    });

    return res.status(200).json({ message: "Chit group activated successfully!", status: "ACTIVE" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/**
 * Claim Invitation / Slot by Token or Registered Phone
 */
const claimInvitationByToken = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { token } = req.body;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const [[user]] = await dbPromise.query("SELECT * FROM users WHERE user_id = ?", [userId]);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Lookup invitation by token OR user phone/email match
    const [[invitation]] = await dbPromise.query(
      `SELECT * FROM chit_invitations 
       WHERE (invitation_token = ? OR invitee_phone = ? OR invitee_email = ? OR user_id = ?) 
         AND status = 'PENDING' LIMIT 1`,
      [token || "", user.phone, user.email, userId]
    );

    if (!invitation) {
      return res.status(404).json({ message: "No pending invitation found for your account." });
    }

    const chitId = invitation.chit_id;

    // Check if slot exists for Fixed Chit
    const [[slot]] = await dbPromise.query(
      "SELECT * FROM chit_member_slots WHERE chit_id = ? AND (invitation_token = ? OR invitee_phone = ? OR invitee_email = ? OR member_id = ?)",
      [chitId, token || "", user.phone, user.email, userId]
    );

    const assignedMonth = slot ? slot.assigned_month : null;

    // Join chit_members
    await dbPromise.query(
      `INSERT INTO chit_members (chit_id, member_id, assigned_month, status, unpaid_streak, total_missed_count, has_won_auction)
       VALUES (?, ?, ?, 'ACCEPTED', 0, 0, 0)
       ON DUPLICATE KEY UPDATE status = 'ACCEPTED', assigned_month = VALUES(assigned_month)`,
      [chitId, userId, assignedMonth]
    );

    // Update invitation status
    await dbPromise.query(
      "UPDATE chit_invitations SET status = 'ACCEPTED', user_id = ? WHERE invitation_id = ?",
      [userId, invitation.invitation_id]
    );

    if (slot) {
      await dbPromise.query(
        "UPDATE chit_member_slots SET status = 'ACCEPTED', member_id = ? WHERE slot_id = ?",
        [userId, slot.slot_id]
      );
    }

    return res.status(200).json({
      message: "Invitation accepted successfully!",
      chit_id: chitId,
      assigned_month: assignedMonth,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/**
 * Get All Chits for User/Admin with upgraded filters
 */
const getChits = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    let rows;
    if (req.user.role === "ADMIN") {
      [rows] = await dbPromise.query(
        `SELECT c.*, u.name AS admin_name, 
                (SELECT COUNT(*) FROM chit_members cm WHERE cm.chit_id = c.chit_id) AS joined_members
         FROM chits c JOIN users u ON u.user_id = c.admin_id
         WHERE c.admin_id = ? ORDER BY c.created_at DESC`,
        [userId]
      );
    } else {
      [rows] = await dbPromise.query(
        `SELECT c.*, u.name AS admin_name,
                cm.status AS membership_status, cm.assigned_month,
                ci.invitation_id, ci.status AS invitation_status, ci.invitation_token
         FROM chits c
         JOIN users u ON u.user_id = c.admin_id
         LEFT JOIN chit_members cm ON cm.chit_id = c.chit_id AND cm.member_id = ?
         LEFT JOIN chit_invitations ci ON ci.chit_id = c.chit_id AND (ci.user_id = ? OR ci.invitee_phone = (SELECT phone FROM users WHERE user_id = ?))
         WHERE cm.chit_member_id IS NOT NULL OR ci.invitation_id IS NOT NULL
         ORDER BY c.created_at DESC`,
        [userId, userId, userId]
      );
    }

    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/**
 * Get Detailed Info of Single Chit (Includes Monthly Rules, Member Slots, Payments, Auctions)
 */
const getChitDetails = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { chitId } = req.params;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const [[chit]] = await dbPromise.query(
      `SELECT c.*, u.name AS admin_name, u.phone AS admin_phone 
       FROM chits c JOIN users u ON u.user_id = c.admin_id WHERE c.chit_id = ?`,
      [chitId]
    );

    if (!chit) return res.status(404).json({ message: "Chit not found" });

    const [monthlyRules] = await dbPromise.query(
      "SELECT * FROM chit_monthly_rules WHERE chit_id = ? ORDER BY month_number ASC",
      [chitId]
    );

    const [slots] = await dbPromise.query(
      `SELECT s.*, u.name AS claimed_member_name 
       FROM chit_member_slots s LEFT JOIN users u ON u.user_id = s.member_id 
       WHERE s.chit_id = ? ORDER BY s.assigned_month ASC`,
      [chitId]
    );

    const [members] = await dbPromise.query(
      `SELECT cm.*, u.name, u.phone, u.email, u.merit_score 
       FROM chit_members cm JOIN users u ON u.user_id = cm.member_id 
       WHERE cm.chit_id = ? ORDER BY cm.joined_at ASC`,
      [chitId]
    );

    const [auctions] = await dbPromise.query(
      `SELECT a.*, u.name AS winner_name 
       FROM auctions a LEFT JOIN users u ON u.user_id = a.winning_member_id 
       WHERE a.chit_id = ? ORDER BY a.installment_number DESC`,
      [chitId]
    );

    const [payments] = await dbPromise.query(
      `SELECT p.*, u.name AS member_name 
       FROM payments p JOIN users u ON u.user_id = p.member_id 
       WHERE p.chit_id = ? ORDER BY p.installment_number DESC`,
      [chitId]
    );

    const simulation = generateFinancialSimulation({
      type: chit.type,
      chitValue: chit.chit_value,
      durationMonths: chit.duration_months,
      totalMembers: chit.total_members,
      commissionRate: chit.admin_commission_rate,
      monthlyRules,
    });

    return res.status(200).json({
      chit,
      monthlyRules,
      slots,
      members,
      auctions,
      payments,
      simulation,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getInvitations = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const [[user]] = await dbPromise.query("SELECT * FROM users WHERE user_id = ?", [userId]);

    const [rows] = await dbPromise.query(
      `
        SELECT 
          ci.invitation_id, 
          ci.invitation_token,
          ci.status,
          ci.created_at as invited_at,
          c.chit_id,
          c.group_name,
          c.type,
          c.chit_value,
          c.duration_months,
          c.monthly_installment,
          c.start_date,
          u.name AS admin_name,
          cms.assigned_month
        FROM chit_invitations ci
        JOIN chits c ON c.chit_id = ci.chit_id
        JOIN users u ON u.user_id = c.admin_id
        LEFT JOIN chit_member_slots cms ON cms.chit_id = c.chit_id AND (cms.member_id = ? OR cms.invitee_phone = ? OR cms.invitee_email = ?)
        WHERE (ci.user_id = ? OR ci.invitee_phone = ? OR ci.invitee_email = ?) AND ci.status = 'PENDING'
        ORDER BY ci.created_at DESC
      `,
      [userId, user.phone, user.email, userId, user.phone, user.email]
    );

    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createWizardChit,
  saveMonthlyRules,
  configureMemberSlots,
  getFinancialSimulationPreview,
  activateChit,
  claimInvitationByToken,
  getChits,
  getChitDetails,
  getInvitations,
};
