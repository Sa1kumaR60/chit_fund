/**
 * Smart Rule Engine Service for Financial Calculations, Dividends, and Financial Simulations
 */

/**
 * Calculates Fixed Chit Financial Schedule
 */
function calculateFixedChitSchedule(chitValue, durationMonths, totalMembers, adminCommissionRate = 0.05) {
  const baseMonthlyInstallment = Number(chitValue) / Number(durationMonths);
  const monthlyCommission = (Number(chitValue) * Number(adminCommissionRate)) / Number(durationMonths);
  const netMonthlyPayout = Number(chitValue) - (Number(chitValue) * Number(adminCommissionRate));

  const schedule = [];
  for (let month = 1; month <= durationMonths; month++) {
    schedule.push({
      monthNumber: month,
      installmentAmount: Number(baseMonthlyInstallment.toFixed(2)),
      totalPoolCollected: Number((baseMonthlyInstallment * totalMembers).toFixed(2)),
      adminCommission: Number(monthlyCommission.toFixed(2)),
      payoutAmount: Number(netMonthlyPayout.toFixed(2)),
    });
  }

  return {
    chitValue: Number(chitValue),
    durationMonths: Number(durationMonths),
    totalMembers: Number(totalMembers),
    baseMonthlyInstallment: Number(baseMonthlyInstallment.toFixed(2)),
    monthlyCommission: Number(monthlyCommission.toFixed(2)),
    netMonthlyPayout: Number(netMonthlyPayout.toFixed(2)),
    schedule,
  };
}

/**
 * Calculates Auction Chit Installments & Dividends dynamically after a live auction
 */
function calculateAuctionInstallmentResult({
  chitValue,
  durationMonths,
  totalMembers,
  winningDiscount,
  commissionRate = 0.05,
  commissionTiming = 'MONTHLY',
}) {
  const baseMonthlyInstallment = Number(chitValue) / Number(durationMonths);
  const totalCommission = Number(chitValue) * Number(commissionRate);
  const monthlyCommission = totalCommission / Number(durationMonths);

  let winnerPayout = Number(chitValue) - Number(winningDiscount);
  if (commissionTiming === 'ON_PAYOUT') {
    winnerPayout -= totalCommission;
  }

  // Calculate dividend pool to distribute among non-winners
  let dividendPool = Number(winningDiscount);
  if (commissionTiming === 'MONTHLY') {
    dividendPool -= monthlyCommission;
  }

  const nonWinnersCount = Math.max(1, Number(totalMembers) - 1);
  const dividendPerNonWinner = Math.max(0, dividendPool / nonWinnersCount);
  const nonWinnerPayableAmount = Math.max(0, baseMonthlyInstallment - dividendPerNonWinner);
  const winnerPayableAmount = baseMonthlyInstallment;

  return {
    baseMonthlyInstallment: Number(baseMonthlyInstallment.toFixed(2)),
    winningDiscount: Number(winningDiscount),
    winnerPayout: Number(winnerPayout.toFixed(2)),
    totalCommissionCollected: commissionTiming === 'MONTHLY' 
      ? Number(monthlyCommission.toFixed(2)) 
      : Number(totalCommission.toFixed(2)),
    dividendPool: Number(dividendPool.toFixed(2)),
    dividendPerNonWinner: Number(dividendPerNonWinner.toFixed(2)),
    nonWinnerPayableAmount: Number(nonWinnerPayableAmount.toFixed(2)),
    winnerPayableAmount: Number(winnerPayableAmount.toFixed(2)),
  };
}

/**
 * Evaluates Late Fees, Grace Period & Merit Score Deltas
 */
function evaluatePaymentStatus({ dueDateStr, paymentDateStr, gracePeriodDays = 5, lateFeeRate = 0.02, installmentAmount = 0 }) {
  const dueDate = new Date(dueDateStr);
  const paymentDate = paymentDateStr ? new Date(paymentDateStr) : new Date();

  // Strip time for accurate day difference comparison
  const dueDateOnly = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  const payDateOnly = new Date(paymentDate.getFullYear(), paymentDate.getMonth(), paymentDate.getDate());

  const diffTime = payDateOnly.getTime() - dueDateOnly.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  let paymentStatus = 'ON_TIME_PAYMENT';
  let meritDelta = 2;
  let lateFee = 0;

  if (diffDays <= -3) {
    // Paid 3 or more days before due date
    paymentStatus = 'PAID_EARLY';
    meritDelta = 3;
  } else if (diffDays <= 0) {
    // Paid on or within 3 days before due date
    paymentStatus = 'PAID_ON_TIME';
    meritDelta = 2;
  } else if (diffDays <= gracePeriodDays) {
    // Paid within grace period
    paymentStatus = 'LATE_PAYMENT';
    meritDelta = -5;
    lateFee = Number((Number(installmentAmount) * Number(lateFeeRate)).toFixed(2));
  } else {
    // Paid after grace period / unpaid
    paymentStatus = 'UNPAID';
    meritDelta = -10;
    lateFee = Number((Number(installmentAmount) * Number(lateFeeRate) * 1.5).toFixed(2));
  }

  return {
    paymentStatus,
    meritDelta,
    lateFee,
    diffDays,
  };
}

/**
 * Generates Full Pre-activation Month-by-Month Simulation for Admin Review
 */
function generateFinancialSimulation({ type, chitValue, durationMonths, totalMembers, commissionRate = 0.05, monthlyRules = [] }) {
  const chitVal = Number(chitValue);
  const duration = Number(durationMonths);
  const members = Number(totalMembers);
  const baseInstallment = chitVal / duration;
  const monthlyCommission = (chitVal * Number(commissionRate)) / duration;

  const monthProjections = [];

  for (let month = 1; month <= duration; month++) {
    const customRule = monthlyRules.find((r) => Number(r.month_number) === month) || {};

    if (type === 'FIXED') {
      monthProjections.push({
        monthNumber: month,
        expectedWinnerPays: Number(baseInstallment.toFixed(2)),
        expectedNonWinnerPays: Number(baseInstallment.toFixed(2)),
        expectedCollection: Number((baseInstallment * members).toFixed(2)),
        adminCommission: Number(monthlyCommission.toFixed(2)),
        payoutAmount: Number((chitVal - chitVal * Number(commissionRate)).toFixed(2)),
        estimatedDividend: 0,
      });
    } else {
      // AUCTION CHIT projection based on rules or defaults
      const winnerPays = customRule.winner_pays_amount ? Number(customRule.winner_pays_amount) : baseInstallment;
      const nonWinnerPays = customRule.non_winner_pays_amount ? Number(customRule.non_winner_pays_amount) : baseInstallment * 0.9;
      const minDiscount = customRule.min_discount ? Number(customRule.min_discount) : chitVal * 0.05;
      const maxDiscount = customRule.max_discount ? Number(customRule.max_discount) : chitVal * 0.30;

      const estimatedDiscount = (minDiscount + maxDiscount) / 2;
      const estimatedDividendPerMember = Math.max(0, (estimatedDiscount - monthlyCommission) / (members - 1));
      const totalExpectedCollection = winnerPays + nonWinnerPays * (members - 1);

      monthProjections.push({
        monthNumber: month,
        expectedWinnerPays: Number(winnerPays.toFixed(2)),
        expectedNonWinnerPays: Number(nonWinnerPays.toFixed(2)),
        minDiscountAllowed: Number(minDiscount.toFixed(2)),
        maxDiscountAllowed: Number(maxDiscount.toFixed(2)),
        estimatedWinningDiscount: Number(estimatedDiscount.toFixed(2)),
        estimatedDividend: Number(estimatedDividendPerMember.toFixed(2)),
        expectedCollection: Number(totalExpectedCollection.toFixed(2)),
        adminCommission: Number(monthlyCommission.toFixed(2)),
        payoutAmount: Number((chitVal - estimatedDiscount).toFixed(2)),
      });
    }
  }

  const totalExpectedCollections = monthProjections.reduce((sum, p) => sum + p.expectedCollection, 0);
  const totalAdminCommission = monthProjections.reduce((sum, p) => sum + p.adminCommission, 0);

  return {
    type,
    chitValue: chitVal,
    durationMonths: duration,
    totalMembers: members,
    baseInstallment: Number(baseInstallment.toFixed(2)),
    totalExpectedCollections: Number(totalExpectedCollections.toFixed(2)),
    totalAdminCommission: Number(totalAdminCommission.toFixed(2)),
    monthProjections,
  };
}

module.exports = {
  calculateFixedChitSchedule,
  calculateAuctionInstallmentResult,
  evaluatePaymentStatus,
  generateFinancialSimulation,
};
