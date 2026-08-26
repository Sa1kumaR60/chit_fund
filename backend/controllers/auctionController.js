const db = require("../db");
const { getMemberFinancialSummary } = require("../utils/memberFinance");
const {
  calculateCashflowAuctionPreview,
  roundCurrency,
} = require("../utils/chitCalculations");
const {
  AUCTION_MEMBER_STATUSES,
  upsertMonthlyPool,
  getPaidEligibleMembers,
} = require("../utils/monthlyPools");
const { recordAuditLog } = require("../utils/auditLog");

const dbPromise = db.promise();

const auctionStatusPlaceholders = AUCTION_MEMBER_STATUSES.map(() => "?").join(", ");

const toNumber = (value) => Number(value || 0);

const getAdminOwnedChit = async (dbConn, chitId, adminId) => {
  const [[chit]] = await dbConn.query("SELECT * FROM chits WHERE chit_id = ?", [chitId]);

  if (!chit) {
    return { error: { status: 404, message: "Chit not found" } };
  }

  if (Number(chit.admin_id) !== Number(adminId)) {
    return { error: { status: 403, message: "You do not manage this chit group" } };
  }

  return { chit };
};

const startAuction = async (req, res) => {
  const adminId = req.user?.id;
  const {
    chit_id,
    installment_number,
    allow_partial_collection = false,
    partial_approval_reason = "",
  } = req.body;

  if (!adminId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Only admins can start auctions" });
  }

  if (!chit_id || !installment_number) {
    return res.status(400).json({ message: "chit_id and installment_number are required" });
  }

  const installmentNumber = Number(installment_number);

  if (!Number.isInteger(installmentNumber) || installmentNumber <= 0) {
    return res.status(400).json({ message: "Installment number must be a positive integer" });
  }

  const connection = await dbPromise.getConnection();
  await connection.beginTransaction();

  try {
    const { chit, error } = await getAdminOwnedChit(connection, chit_id, adminId);
    if (error) {
      await connection.rollback();
      return res.status(error.status).json({ message: error.message });
    }

    if (installmentNumber > Number(chit.duration_months)) {
      await connection.rollback();
      return res.status(400).json({ message: "Installment number exceeds chit duration" });
    }

    const [[existingAuction]] = await connection.query(
      "SELECT * FROM auctions WHERE chit_id = ? AND installment_number = ?",
      [chit_id, installmentNumber]
    );

    if (existingAuction) {
      await connection.rollback();
      return res.status(400).json({ message: "Auction already exists for this installment" });
    }

    const poolSnapshot = await upsertMonthlyPool(connection, chit, installmentNumber);
    const manualApproval = Boolean(allow_partial_collection);

    if (!poolSnapshot.isReady && !manualApproval) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "Auction cannot start until the minimum paid members and collection requirements are met.",
        requirements: {
          minimum_members_required: poolSnapshot.minimumMembersRequired,
          paid_member_count: poolSnapshot.paidMemberCount,
          minimum_collection_required: poolSnapshot.minimumCollectionRequired,
          collected_amount: poolSnapshot.poolAmount,
          pending_installment_amount: poolSnapshot.pendingInstallmentAmount,
        },
      });
    }

    if (manualApproval && (poolSnapshot.paidMemberCount === 0 || poolSnapshot.poolAmount <= 0)) {
      await connection.rollback();
      return res.status(400).json({
        message: "Partial approval still requires at least one verified payment in the pool.",
      });
    }

    const preview = calculateCashflowAuctionPreview({
      collectedAmount: poolSnapshot.poolAmount,
      paidMemberCount: poolSnapshot.paidMemberCount,
      adminCommissionRate: chit.admin_commission_rate,
      reserveRate: chit.reserve_rate,
      discountPercent: 0,
    });

    const [result] = await connection.query(
      `
        INSERT INTO auctions (
          chit_id,
          installment_number,
          pool_id,
          pool_amount,
          paid_member_count,
          admin_commission_amount,
          reserve_amount,
          auction_base_amount,
          eligible_dividend_count,
          manually_approved_partial,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
      `,
      [
        chit_id,
        installmentNumber,
        poolSnapshot.pool.pool_id,
        preview.collectedAmount,
        preview.paidMemberCount,
        preview.adminCommissionAmount,
        preview.reserveAmount,
        preview.auctionBaseAmount,
        preview.eligibleDividendMembers,
        manualApproval ? 1 : 0,
      ]
    );

    await connection.query(
      `
        UPDATE monthly_pools
        SET auction_id = ?,
            commission_amount = ?,
            reserve_amount = ?,
            winner_payout = ?,
            manually_approved = ?,
            approved_by = ?,
            approved_at = CASE WHEN ? = 1 THEN NOW() ELSE approved_at END,
            status = 'LOCKED'
        WHERE pool_id = ?
      `,
      [
        result.insertId,
        preview.adminCommissionAmount,
        preview.reserveAmount,
        preview.auctionBaseAmount,
        manualApproval ? 1 : 0,
        manualApproval ? adminId : null,
        manualApproval ? 1 : 0,
        poolSnapshot.pool.pool_id,
      ]
    );

    await recordAuditLog(connection, {
      userId: adminId,
      actionType: manualApproval ? "PARTIAL_COLLECTION_APPROVED" : "AUCTION_STARTED",
      referenceType: "AUCTION",
      referenceId: result.insertId,
      details: {
        chit_id: Number(chit_id),
        installment_number: installmentNumber,
        collected_amount: preview.collectedAmount,
        paid_member_count: preview.paidMemberCount,
        minimum_members_required: poolSnapshot.minimumMembersRequired,
        minimum_collection_required: poolSnapshot.minimumCollectionRequired,
        partial_approval_reason,
      },
    });

    await connection.commit();

    return res.status(201).json({
      message: "Auction started successfully from verified monthly collection pool",
      auction: {
        auction_id: result.insertId,
        chit_id: Number(chit_id),
        installment_number: installmentNumber,
        pool_id: poolSnapshot.pool.pool_id,
        pool_amount: preview.collectedAmount,
        paid_member_count: preview.paidMemberCount,
        admin_commission_amount: preview.adminCommissionAmount,
        reserve_amount: preview.reserveAmount,
        auction_base_amount: preview.auctionBaseAmount,
        status: "OPEN",
      },
      pool: poolSnapshot,
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({ message: error.message });
  } finally {
    connection.release();
  }
};

const placeBid = async (req, res) => {
  try {
    const memberId = req.user?.id;
    const { auctionId } = req.params;
    const { discount_percent } = req.body;

    if (!memberId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (req.user.role !== "MEMBER") {
      return res.status(403).json({ message: "Only members can place bids" });
    }

    if (discount_percent === undefined || discount_percent === null) {
      return res.status(400).json({ message: "discount_percent is required" });
    }

    const discountPercent = Number(discount_percent);

    if (Number.isNaN(discountPercent) || discountPercent <= 0) {
      return res.status(400).json({ message: "Discount percent must be greater than 0" });
    }

    const [[auction]] = await dbPromise.query(
      `
        SELECT
          a.*,
          c.admin_id,
          c.chit_id,
          c.chit_value,
          c.total_members,
          c.admin_commission_rate,
          c.reserve_rate,
          c.start_date,
          c.duration_months,
          c.monthly_installment,
          c.late_fee_rate
        FROM auctions a
        JOIN chits c ON c.chit_id = a.chit_id
        WHERE a.auction_id = ?
      `,
      [auctionId]
    );

    if (!auction) {
      return res.status(404).json({ message: "Auction not found" });
    }

    if (auction.status !== "OPEN") {
      return res.status(400).json({ message: "This auction is not open for bidding" });
    }

    const [[membership]] = await dbPromise.query(
      `
        SELECT cm.*, p.payment_id
        FROM chit_members cm
        JOIN payments p
          ON p.chit_id = cm.chit_id
         AND p.member_id = cm.member_id
         AND p.installment_number = ?
         AND p.payment_status IN ('PAID_ON_TIME', 'LATE_PAYMENT')
        WHERE cm.chit_id = ?
          AND cm.member_id = ?
      `,
      [auction.installment_number, auction.chit_id, memberId]
    );

    if (!membership) {
      return res.status(403).json({
        message: "Only members who paid this installment can participate in this auction",
      });
    }

    if (!AUCTION_MEMBER_STATUSES.includes(membership.status)) {
      return res.status(400).json({ message: "Only active paid members can bid" });
    }

    if (membership.has_won_auction) {
      return res.status(400).json({ message: "Members who already won cannot bid again" });
    }

    const summary = await getMemberFinancialSummary(dbPromise, auction, memberId);

    if (summary.isDefaulter) {
      return res.status(400).json({ message: "Defaulters cannot participate in auctions" });
    }

    const preview = calculateCashflowAuctionPreview({
      collectedAmount: auction.pool_amount,
      paidMemberCount: auction.paid_member_count,
      adminCommissionRate: auction.admin_commission_rate,
      reserveRate: auction.reserve_rate,
      discountPercent,
    });

    if (discountPercent > preview.maxSafeDiscountPercent || preview.winnerPayout <= 0) {
      return res.status(400).json({
        message: `Discount is too high for this pool. Maximum safe discount is ${preview.maxSafeDiscountPercent}%.`,
      });
    }

    await dbPromise.query(
      `
        INSERT INTO bids (
          auction_id,
          chit_id,
          member_id,
          discount_percent,
          discount_amount,
          estimated_payout,
          distribution_per_member,
          is_winner
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ON DUPLICATE KEY UPDATE
          discount_percent = VALUES(discount_percent),
          discount_amount = VALUES(discount_amount),
          estimated_payout = VALUES(estimated_payout),
          distribution_per_member = VALUES(distribution_per_member),
          bid_at = CURRENT_TIMESTAMP,
          is_winner = 0
      `,
      [
        auctionId,
        auction.chit_id,
        memberId,
        discountPercent,
        preview.discountAmount,
        preview.winnerPayout,
        preview.distributionPerMember,
      ]
    );

    return res.status(201).json({
      message: "Bid placed successfully",
      bid_preview: preview,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const calculateAuctionResult = async (req, res) => {
  const adminId = req.user?.id;
  const { auctionId } = req.params;

  if (!adminId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Only admins can close auctions" });
  }

  const connection = await dbPromise.getConnection();
  await connection.beginTransaction();

  try {
    const [[auction]] = await connection.query(
      `
        SELECT
          a.*,
          c.admin_id,
          c.chit_id,
          c.chit_value,
          c.total_members,
          c.admin_commission_rate,
          c.reserve_rate,
          c.start_date,
          c.duration_months,
          c.monthly_installment,
          c.late_fee_rate
        FROM auctions a
        JOIN chits c ON c.chit_id = a.chit_id
        WHERE a.auction_id = ?
        FOR UPDATE
      `,
      [auctionId]
    );

    if (!auction) {
      await connection.rollback();
      return res.status(404).json({ message: "Auction not found" });
    }

    if (Number(auction.admin_id) !== Number(adminId)) {
      await connection.rollback();
      return res.status(403).json({ message: "You do not manage this auction" });
    }

    if (auction.status !== "OPEN") {
      await connection.rollback();
      return res.status(400).json({ message: "Auction is already closed" });
    }

    const [bids] = await connection.query(
      `
        SELECT *
        FROM bids
        WHERE auction_id = ?
        ORDER BY discount_percent DESC, bid_at ASC
      `,
      [auctionId]
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        message: "At least one bid is required to calculate the result",
      });
    }

    const winningBid = bids[0];
    const winnerId = Number(winningBid.member_id);

    const [[winnerMembership]] = await connection.query(
      `
        SELECT cm.*, p.payment_id
        FROM chit_members cm
        JOIN payments p
          ON p.chit_id = cm.chit_id
         AND p.member_id = cm.member_id
         AND p.installment_number = ?
         AND p.payment_status IN ('PAID_ON_TIME', 'LATE_PAYMENT')
        WHERE cm.chit_id = ?
          AND cm.member_id = ?
          AND cm.status IN (${auctionStatusPlaceholders})
      `,
      [auction.installment_number, auction.chit_id, winnerId, ...AUCTION_MEMBER_STATUSES]
    );

    if (!winnerMembership || winnerMembership.has_won_auction) {
      await connection.rollback();
      return res.status(400).json({
        message: "Winning bidder is no longer eligible for this auction",
      });
    }

    const eligibleDividendMembers = await getPaidEligibleMembers(
      connection,
      auction.chit_id,
      auction.installment_number,
      winnerId
    );

    const preview = calculateCashflowAuctionPreview({
      collectedAmount: auction.pool_amount,
      paidMemberCount: eligibleDividendMembers.length + 1,
      adminCommissionRate: auction.admin_commission_rate,
      reserveRate: auction.reserve_rate,
      discountPercent: winningBid.discount_percent,
    });

    const totalDividendAmount = roundCurrency(
      preview.distributionPerMember * eligibleDividendMembers.length
    );
    const finalReserveAmount = roundCurrency(
      preview.reserveAmount + (preview.discountAmount - totalDividendAmount)
    );
    const totalAllocated = roundCurrency(
      preview.winnerPayout +
        totalDividendAmount +
        preview.adminCommissionAmount +
        finalReserveAmount
    );

    if (totalAllocated > preview.collectedAmount) {
      await connection.rollback();
      return res.status(500).json({
        message: "Auction allocation failed because payouts exceed collected amount",
      });
    }

    await connection.query("UPDATE bids SET is_winner = 0 WHERE auction_id = ?", [auctionId]);
    await connection.query("UPDATE bids SET is_winner = 1 WHERE bid_id = ?", [winningBid.bid_id]);

    await connection.query(
      `
        UPDATE auctions
        SET winning_member_id = ?,
            winning_discount_percent = ?,
            winning_discount_amount = ?,
            winning_payout = ?,
            distribution_per_member = ?,
            distributed_discount_amount = ?,
            eligible_dividend_count = ?,
            admin_commission_amount = ?,
            reserve_amount = ?,
            auction_base_amount = ?,
            status = 'COMPLETED',
            closed_at = NOW()
        WHERE auction_id = ?
      `,
      [
        winnerId,
        winningBid.discount_percent,
        preview.discountAmount,
        preview.winnerPayout,
        preview.distributionPerMember,
        totalDividendAmount,
        eligibleDividendMembers.length,
        preview.adminCommissionAmount,
        finalReserveAmount,
        preview.auctionBaseAmount,
        auctionId,
      ]
    );

    await connection.query(
      "UPDATE chit_members SET has_won_auction = 1 WHERE chit_id = ? AND member_id = ?",
      [auction.chit_id, winnerId]
    );

    const [[winnerWallet]] = await connection.query(
      "SELECT wallet_id FROM wallets WHERE user_id = ? FOR UPDATE",
      [winnerId]
    );

    if (!winnerWallet) {
      throw new Error("Winner wallet not found");
    }

    await connection.query("UPDATE wallets SET balance = balance + ? WHERE wallet_id = ?", [
      preview.winnerPayout,
      winnerWallet.wallet_id,
    ]);
    await connection.query(
      "INSERT INTO transactions (wallet_id, amount, type, reference_id, reference_type, description) VALUES (?, ?, 'AUCTION_WINNING', ?, 'AUCTION', ?)",
      [
        winnerWallet.wallet_id,
        preview.winnerPayout,
        auctionId,
        "Auction winner payout from collected monthly pool",
      ]
    );
    await recordAuditLog(connection, {
      userId: winnerId,
      actionType: "WINNER_PAID",
      referenceType: "AUCTION",
      referenceId: Number(auctionId),
      details: {
        chit_id: auction.chit_id,
        installment_number: auction.installment_number,
        amount: preview.winnerPayout,
        collected_amount: preview.collectedAmount,
      },
    });

    if (preview.distributionPerMember > 0 && eligibleDividendMembers.length > 0) {
      for (const member of eligibleDividendMembers) {
        await connection.query("UPDATE wallets SET balance = balance + ? WHERE wallet_id = ?", [
          preview.distributionPerMember,
          member.wallet_id,
        ]);
      }

      const transactionData = eligibleDividendMembers.map((member) => [
        member.wallet_id,
        preview.distributionPerMember,
        "DIVIDEND",
        Number(auctionId),
        "AUCTION",
        "Auction discount dividend for paid eligible member",
      ]);

      await connection.query(
        "INSERT INTO transactions (wallet_id, amount, type, reference_id, reference_type, description) VALUES ?",
        [transactionData]
      );
      await recordAuditLog(connection, {
        userId: adminId,
        actionType: "DIVIDEND_DISTRIBUTED",
        referenceType: "AUCTION",
        referenceId: Number(auctionId),
        details: {
          eligible_member_count: eligibleDividendMembers.length,
          distribution_per_member: preview.distributionPerMember,
          distributed_discount_amount: totalDividendAmount,
          excluded_winner_id: winnerId,
        },
      });
    }

    const [[adminWallet]] = await connection.query(
      "SELECT wallet_id FROM wallets WHERE user_id = ? FOR UPDATE",
      [adminId]
    );

    if (adminWallet && preview.adminCommissionAmount > 0) {
      await connection.query("UPDATE wallets SET balance = balance + ? WHERE wallet_id = ?", [
        preview.adminCommissionAmount,
        adminWallet.wallet_id,
      ]);
      await connection.query(
        "INSERT INTO transactions (wallet_id, amount, type, reference_id, reference_type, description) VALUES (?, ?, 'COMMISSION', ?, 'AUCTION', ?)",
        [
          adminWallet.wallet_id,
          preview.adminCommissionAmount,
          auctionId,
          "Auction admin commission from collected monthly pool",
        ]
      );
    }

    await recordAuditLog(connection, {
      userId: adminId,
      actionType: "COMMISSION_DEDUCTED",
      referenceType: "AUCTION",
      referenceId: Number(auctionId),
      details: {
        chit_id: auction.chit_id,
        installment_number: auction.installment_number,
        amount: preview.adminCommissionAmount,
      },
    });

    await recordAuditLog(connection, {
      userId: adminId,
      actionType: "RESERVE_LOCKED",
      referenceType: "AUCTION",
      referenceId: Number(auctionId),
      details: {
        chit_id: auction.chit_id,
        installment_number: auction.installment_number,
        reserve_amount: finalReserveAmount,
        rounding_adjustment: roundCurrency(finalReserveAmount - preview.reserveAmount),
      },
    });

    await connection.query(
      `
        UPDATE monthly_pools
        SET auction_winner_id = ?,
            discount_percent = ?,
            discount_amount = ?,
            commission_amount = ?,
            reserve_amount = ?,
            winner_payout = ?,
            distributed_discount_amount = ?,
            status = 'SETTLED'
        WHERE pool_id = ?
      `,
      [
        winnerId,
        winningBid.discount_percent,
        preview.discountAmount,
        preview.adminCommissionAmount,
        finalReserveAmount,
        preview.winnerPayout,
        totalDividendAmount,
        auction.pool_id,
      ]
    );

    await recordAuditLog(connection, {
      userId: adminId,
      actionType: "AUCTION_CLOSED",
      referenceType: "AUCTION",
      referenceId: Number(auctionId),
      details: {
        winner_id: winnerId,
        collected_amount: preview.collectedAmount,
        winner_payout: preview.winnerPayout,
        commission_amount: preview.adminCommissionAmount,
        reserve_amount: finalReserveAmount,
        discount_amount: preview.discountAmount,
        distributed_discount_amount: totalDividendAmount,
        total_allocated: totalAllocated,
      },
    });

    await connection.commit();

    return res.status(200).json({
      message: "Auction result calculated successfully from collected funds",
      result: {
        winning_member_id: winnerId,
        winning_discount_percent: Number(winningBid.discount_percent),
        winning_discount_amount: preview.discountAmount,
        winning_payout: preview.winnerPayout,
        collected_amount: preview.collectedAmount,
        admin_commission_amount: preview.adminCommissionAmount,
        reserve_amount: finalReserveAmount,
        distribution_per_member: preview.distributionPerMember,
        eligible_dividend_count: eligibleDividendMembers.length,
        total_allocated: totalAllocated,
      },
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({ message: error.message });
  } finally {
    connection.release();
  }
};

const getAuctionDetails = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { auctionId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const [[auction]] = await dbPromise.query(
      `
        SELECT
          a.*,
          c.chit_value,
          c.total_members,
          c.admin_id,
          c.admin_commission_rate,
          c.reserve_rate,
          mp.expected_amount,
          mp.minimum_collection_required,
          mp.pending_installment_amount,
          mp.status AS pool_status
        FROM auctions a
        JOIN chits c ON c.chit_id = a.chit_id
        LEFT JOIN monthly_pools mp ON mp.pool_id = a.pool_id
        WHERE a.auction_id = ?
      `,
      [auctionId]
    );

    if (!auction) {
      return res.status(404).json({ message: "Auction not found" });
    }

    if (req.user.role === "MEMBER") {
      const [[membership]] = await dbPromise.query(
        "SELECT chit_member_id FROM chit_members WHERE chit_id = ? AND member_id = ?",
        [auction.chit_id, userId]
      );

      if (!membership) {
        return res.status(403).json({ message: "You are not a member of this chit group" });
      }
    }

    const [bids] = await dbPromise.query(
      `
        SELECT
          b.bid_id,
          b.member_id,
          u.name AS member_name,
          b.discount_percent,
          b.discount_amount,
          b.estimated_payout,
          b.distribution_per_member,
          b.bid_at,
          b.is_winner
        FROM bids b
        JOIN users u ON u.user_id = b.member_id
        WHERE b.auction_id = ?
        ORDER BY b.discount_percent DESC, b.bid_at ASC
      `,
      [auctionId]
    );

    const cashflowPreview = calculateCashflowAuctionPreview({
      collectedAmount: auction.pool_amount,
      paidMemberCount: auction.paid_member_count,
      adminCommissionRate: auction.admin_commission_rate,
      reserveRate: auction.reserve_rate,
      discountPercent: auction.winning_discount_percent || 5,
    });

    return res.status(200).json({
      auction,
      cashflow_preview: cashflowPreview,
      bids:
        req.user.role === "ADMIN" || Number(auction.admin_id) === Number(userId)
          ? bids
          : bids.filter((bid) => Number(bid.member_id) === Number(userId)),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  startAuction,
  placeBid,
  calculateAuctionResult,
  getAuctionDetails,
};
