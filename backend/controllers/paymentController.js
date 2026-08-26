const db = require("../db");
const { getMemberFinancialSummary, getChitFinancialOverview } = require("../utils/memberFinance");
const { calculateLateFee, getInstallmentDueDate } = require("../utils/chitCalculations");
const { upsertMonthlyPool } = require("../utils/monthlyPools");
const { recordAuditLog } = require("../utils/auditLog");

const dbPromise = db.promise();

const makePayment = async (req, res) => {
  try {
    const memberId = req.user?.id;
    const { chit_id, installment_number, payment_date, notes = "" } = req.body;

    if (!memberId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (req.user.role !== "MEMBER") {
      return res.status(403).json({ message: "Only members can make payments" });
    }

    if (!chit_id || !installment_number || !payment_date) {
      return res.status(400).json({
        message: "chit_id, installment_number and payment_date are required",
      });
    }

    const [[chit]] = await dbPromise.query("SELECT * FROM chits WHERE chit_id = ?", [chit_id]);

    if (!chit) {
      return res.status(404).json({ message: "Chit not found" });
    }

    const [[membership]] = await dbPromise.query(
      "SELECT * FROM chit_members WHERE chit_id = ? AND member_id = ?",
      [chit_id, memberId]
    );

    if (!membership) {
      return res.status(403).json({ message: "Join the chit before making payments" });
    }

    const dueDate = getInstallmentDueDate(chit.start_date, installment_number);
    const paymentBreakdown = calculateLateFee({
      amountDue: chit.monthly_installment,
      dueDate,
      paidAt: payment_date,
      lateFeeRate: chit.late_fee_rate,
    });

    const connection = await dbPromise.getConnection();
    await connection.beginTransaction();

    try {
      const [[wallet]] = await connection.query("SELECT * FROM wallets WHERE user_id = ? FOR UPDATE", [memberId]);
      
      if (!wallet || wallet.balance < paymentBreakdown.totalPayable) {
        throw new Error("Insufficient wallet balance");
      }

      await connection.query("UPDATE wallets SET balance = balance - ? WHERE wallet_id = ?", [paymentBreakdown.totalPayable, wallet.wallet_id]);

      const [result] = await connection.query(
        `
          INSERT INTO payments (
            chit_id,
            member_id,
            installment_number,
            due_date,
            paid_at,
            amount_due,
            late_fee,
            amount_paid,
            payment_mode,
            payment_status,
            notes
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          chit_id,
          memberId,
          installment_number,
          dueDate,
          payment_date,
          chit.monthly_installment,
          paymentBreakdown.lateFee,
          paymentBreakdown.totalPayable,
          "WALLET",
          paymentBreakdown.paymentStatus,
          notes,
        ]
      );

      const paymentId = result.insertId;

      await connection.query(
        "INSERT INTO transactions (wallet_id, amount, type, reference_id, reference_type, description) VALUES (?, ?, 'INSTALLMENT_PAYMENT', ?, 'PAYMENT', ?)",
        [wallet.wallet_id, paymentBreakdown.totalPayable, paymentId, `Installment payment for chit ${chit_id}`]
      );

      await recordAuditLog(connection, {
        userId: memberId,
        actionType: "PAYMENT_RECEIVED",
        referenceType: "PAYMENT",
        referenceId: paymentId,
        details: {
          chit_id: Number(chit_id),
          installment_number: Number(installment_number),
          amount_due: Number(chit.monthly_installment),
          late_fee: paymentBreakdown.lateFee,
          amount_paid: paymentBreakdown.totalPayable,
          payment_mode: "WALLET",
        },
      });

      if (paymentBreakdown.lateFee > 0) {
        await connection.query(
          `
            INSERT INTO penalties (
              payment_id,
              chit_id,
              member_id,
              installment_number,
              penalty_type,
              rate_applied,
              amount,
              reason,
              status
            )
            VALUES (?, ?, ?, ?, 'LATE_FEE', ?, ?, ?, 'APPLIED')
          `,
          [
            paymentId,
            chit_id,
            memberId,
            installment_number,
            chit.late_fee_rate,
            paymentBreakdown.lateFee,
            "Late payment fee applied",
          ]
        );
      }

      await upsertMonthlyPool(connection, chit, installment_number);

      const summary = await getMemberFinancialSummary(connection, chit, memberId);
      await connection.query(
        "UPDATE chit_members SET unpaid_streak = ?, status = ? WHERE chit_id = ? AND member_id = ?",
        [summary.unpaidCount, summary.isDefaulter ? "DEFAULTER" : "PAID_CURRENT", chit_id, memberId]
      );

      let meritScoreDelta = 0;
      if (paymentBreakdown.paymentStatus === 'PAID_ON_TIME') {
        meritScoreDelta = 2;
      } else if (paymentBreakdown.paymentStatus === 'LATE_PAYMENT') {
        meritScoreDelta = -5;
      }
      
      if (meritScoreDelta !== 0) {
        await connection.query(
          "UPDATE users SET merit_score = GREATEST(0, LEAST(100, merit_score + ?)) WHERE user_id = ?",
          [meritScoreDelta, memberId]
        );
      }

      await connection.commit();
      connection.release();

      return res.status(201).json({
        message: "Payment recorded successfully",
        payment: {
          payment_id: paymentId,
          installment_number: Number(installment_number),
          due_date: dueDate,
          amount_due: Number(chit.monthly_installment),
          late_fee: paymentBreakdown.lateFee,
          amount_paid: paymentBreakdown.totalPayable,
          payment_status: paymentBreakdown.paymentStatus,
        },
        summary,
      });
    } catch (err) {
      await connection.rollback();
      connection.release();
      throw err;
    }
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Payment already recorded for this installment" });
    }
    if (error.message === "Insufficient wallet balance") {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

const getPaymentStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { chitId } = req.params;
    const requestedMemberId = req.query.member_id ? Number(req.query.member_id) : null;
    const memberId = req.user.role === "ADMIN" ? requestedMemberId : userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const [[chit]] = await dbPromise.query("SELECT * FROM chits WHERE chit_id = ?", [chitId]);

    if (!chit) {
      return res.status(404).json({ message: "Chit not found" });
    }

    if (req.user.role === "ADMIN" && Number(chit.admin_id) !== Number(userId)) {
      return res.status(403).json({ message: "You do not manage this chit group" });
    }

    if (req.user.role === "ADMIN" && !memberId) {
      const [memberships] = await dbPromise.query(
        `
          SELECT
            cm.*,
            u.name,
            u.phone
          FROM chit_members cm
          JOIN users u ON u.user_id = cm.member_id
          WHERE cm.chit_id = ?
          ORDER BY u.name ASC
        `,
        [chitId]
      );

      const memberOverviews = await getChitFinancialOverview(dbPromise, chit, memberships);

      const paid_members = [];
      const unpaid_members = [];

      for (const member of memberOverviews) {
        const memberData = {
          member_id: member.member_id,
          name: member.name,
          phone: member.phone,
          membership_status: member.status,
          summary: member.summary,
        };
        
        if (member.summary.pendingDues > 0) {
          unpaid_members.push(memberData);
        } else {
          paid_members.push(memberData);
        }
      }

      return res.status(200).json({
        chit: {
          chit_id: chit.chit_id,
          group_name: chit.group_name,
          chit_value: chit.chit_value,
          monthly_installment: chit.monthly_installment,
          duration_months: chit.duration_months,
          start_date: chit.start_date,
        },
        paid_members,
        unpaid_members,
      });
    }

    const [[membership]] = await dbPromise.query(
      "SELECT * FROM chit_members WHERE chit_id = ? AND member_id = ?",
      [chitId, memberId]
    );

    if (!membership) {
      return res.status(404).json({ message: "Membership not found for this chit group" });
    }

    const summary = await getMemberFinancialSummary(dbPromise, chit, memberId);

    return res.status(200).json({
      chit: {
        chit_id: chit.chit_id,
        chit_value: chit.chit_value,
        monthly_installment: chit.monthly_installment,
        duration_months: chit.duration_months,
        start_date: chit.start_date,
      },
      membership,
      summary,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  makePayment,
  getPaymentStatus,
};
