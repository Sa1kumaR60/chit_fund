const DEFAULT_ADMIN_COMMISSION_RATE = Number(process.env.ADMIN_COMMISSION_RATE || 0.05);
const DEFAULT_LATE_FEE_RATE = Number(process.env.LATE_FEE_RATE || 0.02);
const DEFAULT_DEFAULTER_MONTHS = Number(process.env.DEFAULTER_MONTHS || 1);
const DEFAULT_RESERVE_RATE = Number(process.env.RESERVE_RATE || 0.02);

const roundCurrency = (value) => Math.round(Number(value) * 100) / 100;
const floorCurrency = (value) => Math.floor(Number(value) * 100) / 100;

const calculateMonthlyInstallment = (chitValue, durationMonths) =>
  roundCurrency(Number(chitValue) / Number(durationMonths));

const calculateEndDate = (startDate, durationMonths) => {
  const date = new Date(startDate);
  date.setMonth(date.getMonth() + Number(durationMonths));
  return date.toISOString().slice(0, 10);
};

const calculateAuctionPreview = ({
  chitValue,
  totalMembers,
  discountPercent = 0,
  adminCommissionRate = DEFAULT_ADMIN_COMMISSION_RATE,
}) => {
  const adminCommissionAmount = roundCurrency(Number(chitValue) * Number(adminCommissionRate));
  const auctionBaseAmount = roundCurrency(Number(chitValue) - adminCommissionAmount);
  const discountAmount = roundCurrency(auctionBaseAmount * (Number(discountPercent) / 100));
  const estimatedPayout = roundCurrency(auctionBaseAmount - discountAmount);
  const distributionPerMember =
    Number(totalMembers) > 0 ? roundCurrency(discountAmount / Number(totalMembers)) : 0;

  return {
    adminCommissionRate: Number(adminCommissionRate),
    adminCommissionAmount,
    auctionBaseAmount,
    discountPercent: Number(discountPercent),
    discountAmount,
    estimatedPayout,
    distributionPerMember,
  };
};

const calculateCashflowAuctionPreview = ({
  collectedAmount,
  paidMemberCount,
  discountPercent = 0,
  adminCommissionRate = DEFAULT_ADMIN_COMMISSION_RATE,
  reserveRate = DEFAULT_RESERVE_RATE,
}) => {
  const poolAmount = roundCurrency(collectedAmount);
  const safePaidMemberCount = Math.max(0, Number(paidMemberCount || 0));
  const safeDiscountPercent = Number(discountPercent || 0);
  const commissionRate = Number(adminCommissionRate || 0);
  const safeReserveRate = Number(reserveRate || 0);

  const adminCommissionAmount = roundCurrency(poolAmount * commissionRate);
  const reserveAmount = roundCurrency(poolAmount * safeReserveRate);
  const discountAmount = roundCurrency(poolAmount * (safeDiscountPercent / 100));
  const winnerPayout = roundCurrency(
    Math.max(0, poolAmount - adminCommissionAmount - reserveAmount - discountAmount)
  );
  const eligibleDividendMembers = Math.max(0, safePaidMemberCount - 1);
  const distributionPerMember =
    eligibleDividendMembers > 0
      ? floorCurrency(discountAmount / eligibleDividendMembers)
      : 0;
  const distributedDiscountAmount = roundCurrency(distributionPerMember * eligibleDividendMembers);
  const undistributedDiscountReserve = roundCurrency(discountAmount - distributedDiscountAmount);

  return {
    collectedAmount: poolAmount,
    paidMemberCount: safePaidMemberCount,
    adminCommissionRate: commissionRate,
    adminCommissionAmount,
    reserveRate: safeReserveRate,
    reserveAmount,
    discountPercent: safeDiscountPercent,
    discountAmount,
    winnerPayout,
    eligibleDividendMembers,
    distributionPerMember,
    distributedDiscountAmount,
    undistributedDiscountReserve,
    finalReserveAmount: roundCurrency(reserveAmount + undistributedDiscountReserve),
    auctionBaseAmount: roundCurrency(poolAmount - adminCommissionAmount - reserveAmount),
    maxSafeDiscountPercent: Math.max(0, roundCurrency(100 - commissionRate * 100 - safeReserveRate * 100)),
  };
};

const calculatePayoutDeductions = (estimatedPayout, pendingDues, nextInstallment) => {
  const totalDeductions = roundCurrency(Number(pendingDues) + Number(nextInstallment));
  const netPayout = roundCurrency(Math.max(0, Number(estimatedPayout) - totalDeductions));
  const remainingDebt = roundCurrency(Math.max(0, totalDeductions - Number(estimatedPayout)));

  return {
    estimatedPayout: Number(estimatedPayout),
    pendingDues: Number(pendingDues),
    nextInstallment: Number(nextInstallment),
    totalDeductions,
    netPayout,
    remainingDebt,
  };
};

const getInstallmentDueDate = (startDate, installmentNumber) => {
  const date = new Date(startDate);
  date.setMonth(date.getMonth() + (Number(installmentNumber) - 1));
  return date.toISOString().slice(0, 10);
};

const getDueInstallmentCount = (startDate, durationMonths, referenceDate = new Date()) => {
  const start = new Date(startDate);
  const reference = new Date(referenceDate);

  if (reference < start) {
    return 0;
  }

  let months =
    (reference.getFullYear() - start.getFullYear()) * 12 +
    (reference.getMonth() - start.getMonth()) +
    1;

  if (months < 0) {
    months = 0;
  }

  return Math.min(months, Number(durationMonths));
};

const calculateLateFee = ({
  amountDue,
  dueDate,
  paidAt,
  lateFeeRate = DEFAULT_LATE_FEE_RATE,
}) => {
  const due = new Date(dueDate);
  const paid = new Date(paidAt);

  if (paid <= due) {
    return {
      paymentStatus: "PAID_ON_TIME",
      lateFee: 0,
      totalPayable: roundCurrency(amountDue),
    };
  }

  const lateFee = roundCurrency(Number(amountDue) * Number(lateFeeRate));

  return {
    paymentStatus: "LATE_PAYMENT",
    lateFee,
    totalPayable: roundCurrency(Number(amountDue) + lateFee),
  };
};

module.exports = {
  DEFAULT_ADMIN_COMMISSION_RATE,
  DEFAULT_LATE_FEE_RATE,
  DEFAULT_DEFAULTER_MONTHS,
  DEFAULT_RESERVE_RATE,
  roundCurrency,
  floorCurrency,
  calculateMonthlyInstallment,
  calculateEndDate,
  calculateAuctionPreview,
  calculateCashflowAuctionPreview,
  calculatePayoutDeductions,
  getInstallmentDueDate,
  getDueInstallmentCount,
  calculateLateFee,
};
