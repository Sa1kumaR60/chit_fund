const db = require('../db');
const { calculateAuctionInstallmentResult } = require('./ruleEngine');
const auditLog = require('../utils/auditLog');

/**
 * Live Auction Management Service
 */

async function startAuction(chitId, installmentNumber) {
  const [chits] = await db.promise().query(
    `SELECT * FROM chits WHERE chit_id = ?`,
    [chitId]
  );
  if (!chits.length) throw new Error('Chit not found');
  const chit = chits[0];

  if (chit.type !== 'AUCTION') {
    throw new Error('Auctions can only be run for Auction Chit Groups');
  }

  // Check if auction already exists for this installment
  const [existing] = await db.promise().query(
    `SELECT * FROM auctions WHERE chit_id = ? AND installment_number = ?`,
    [chitId, installmentNumber]
  );

  let auctionId;
  if (existing.length > 0) {
    auctionId = existing[0].auction_id;
    await db.promise().query(
      `UPDATE auctions SET status = 'RUNNING', started_at = NOW() WHERE auction_id = ?`,
      [auctionId]
    );
  } else {
    const [res] = await db.promise().query(
      `INSERT INTO auctions (chit_id, installment_number, pool_amount, auction_base_amount, status, started_at)
       VALUES (?, ?, ?, ?, 'RUNNING', NOW())`,
      [chitId, installmentNumber, chit.chit_value, chit.chit_value]
    );
    auctionId = res.insertId;
  }

  // Update Chit status to AUCTION_RUNNING
  await db.promise().query(
    `UPDATE chits SET status = 'AUCTION_RUNNING' WHERE chit_id = ?`,
    [chitId]
  );

  return { auctionId, chitId, installmentNumber, status: 'RUNNING' };
}

async function placeBid({ auctionId, memberId, bidDiscountAmount }) {
  const [auctions] = await db.promise().query(
    `SELECT a.*, c.chit_value, c.max_discount_allowed, c.min_bid_amount, c.duration_months, c.total_members 
     FROM auctions a JOIN chits c ON a.chit_id = c.chit_id WHERE a.auction_id = ?`,
    [auctionId]
  );
  if (!auctions.length) throw new Error('Auction not found');
  const auction = auctions[0];

  if (auction.status !== 'RUNNING') {
    throw new Error('Auction is not currently running');
  }

  // Verify member hasn't won a previous auction in this chit
  const [memberCheck] = await db.promise().query(
    `SELECT has_won_auction FROM chit_members WHERE chit_id = ? AND member_id = ?`,
    [auction.chit_id, memberId]
  );
  if (!memberCheck.length) throw new Error('Member is not part of this chit');
  if (memberCheck[0].has_won_auction) {
    throw new Error('Member has already won an auction in this chit group');
  }

  const discountVal = Number(bidDiscountAmount);
  if (auction.max_discount_allowed && discountVal > Number(auction.max_discount_allowed)) {
    throw new Error(`Bid discount ₹${discountVal} exceeds maximum allowed discount ₹${auction.max_discount_allowed}`);
  }
  if (auction.min_bid_amount && discountVal < Number(auction.min_bid_amount)) {
    throw new Error(`Bid discount ₹${discountVal} is below minimum allowed bid discount ₹${auction.min_bid_amount}`);
  }

  const discountPercent = (discountVal / Number(auction.chit_value)) * 100;
  const estimatedPayout = Number(auction.chit_value) - discountVal;

  // Insert or update bid
  await db.promise().query(
    `INSERT INTO bids (auction_id, chit_id, member_id, discount_percent, discount_amount, estimated_payout, distribution_per_member, is_winner)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)
     ON DUPLICATE KEY UPDATE discount_percent = VALUES(discount_percent), discount_amount = VALUES(discount_amount), estimated_payout = VALUES(estimated_payout)`,
    [auctionId, auction.chit_id, memberId, discountPercent, discountVal, estimatedPayout]
  );

  return { auctionId, memberId, discountAmount: discountVal, discountPercent, estimatedPayout };
}

async function closeAuctionAndDeclareWinner(auctionId, manualWinnerId = null) {
  const [auctions] = await db.promise().query(
    `SELECT a.*, c.chit_value, c.duration_months, c.total_members, c.admin_commission_rate, c.commission_payout_timing, c.auction_method
     FROM auctions a JOIN chits c ON a.chit_id = c.chit_id WHERE a.auction_id = ?`,
    [auctionId]
  );
  if (!auctions.length) throw new Error('Auction not found');
  const auction = auctions[0];

  const [bids] = await db.promise().query(
    `SELECT * FROM bids WHERE auction_id = ? ORDER BY discount_amount DESC, bid_at ASC`,
    [auctionId]
  );

  let winningBid = null;
  if (manualWinnerId) {
    winningBid = bids.find(b => b.member_id === Number(manualWinnerId));
  } else if (bids.length > 0) {
    // Highest discount wins by default
    winningBid = bids[0];
  }

  let winnerId = winningBid ? winningBid.member_id : null;
  let winningDiscount = winningBid ? Number(winningBid.discount_amount) : Number(auction.chit_value) * 0.05; // Fallback 5% min discount if no bids

  // Calculate financial output using Rule Engine
  const calcResult = calculateAuctionInstallmentResult({
    chitValue: auction.chit_value,
    durationMonths: auction.duration_months,
    totalMembers: auction.total_members,
    winningDiscount,
    commissionRate: auction.admin_commission_rate,
    commissionTiming: auction.commission_payout_timing,
  });

  // Mark winning bid
  if (winnerId) {
    await db.promise().query(
      `UPDATE bids SET is_winner = 1 WHERE auction_id = ? AND member_id = ?`,
      [auctionId, winnerId]
    );
    await db.promise().query(
      `UPDATE chit_members SET has_won_auction = 1 WHERE chit_id = ? AND member_id = ?`,
      [auction.chit_id, winnerId]
    );
  }

  // Update auction record
  await db.promise().query(
    `UPDATE auctions SET 
       winning_member_id = ?, 
       winning_discount_amount = ?, 
       winning_payout = ?, 
       admin_commission_amount = ?,
       distribution_per_member = ?,
       status = 'COMPLETED',
       closed_at = NOW()
     WHERE auction_id = ?`,
    [
      winnerId,
      winningDiscount,
      calcResult.winnerPayout,
      calcResult.totalCommissionCollected,
      calcResult.dividendPerNonWinner,
      auctionId,
    ]
  );

  // Deposit Winner Payout to Winner Wallet (if winner exists)
  if (winnerId) {
    await db.promise().query(
      `UPDATE wallets SET balance = balance + ? WHERE user_id = ?`,
      [calcResult.winnerPayout, winnerId]
    );
    const [w] = await db.promise().query(`SELECT wallet_id FROM wallets WHERE user_id = ?`, [winnerId]);
    if (w.length > 0) {
      await db.promise().query(
        `INSERT INTO transactions (wallet_id, amount, type, reference_id, reference_type, description)
         VALUES (?, ?, 'AUCTION_WINNING', ?, 'AUCTION', ?)`,
        [w[0].wallet_id, calcResult.winnerPayout, auctionId, `Won Auction Month ${auction.installment_number}`]
      );
    }
  }

  // Update Chit status to PAYMENT_COLLECTION
  await db.promise().query(
    `UPDATE chits SET status = 'PAYMENT_COLLECTION' WHERE chit_id = ?`,
    [auction.chit_id]
  );

  await auditLog.record({
    userId: winnerId,
    actionType: 'AUCTION_CLOSED',
    referenceType: 'AUCTION',
    referenceId: auctionId,
    details: {
      chitId: auction.chit_id,
      installmentNumber: auction.installment_number,
      winnerId,
      winningDiscount,
      winnerPayout: calcResult.winnerPayout,
      dividendPerNonWinner: calcResult.dividendPerNonWinner,
    },
  });

  return {
    auctionId,
    winnerId,
    winningDiscount,
    calcResult,
  };
}

module.exports = {
  startAuction,
  placeBid,
  closeAuctionAndDeclareWinner,
};
