const { DEFAULT_DEFAULTER_MONTHS, getDueInstallmentCount, roundCurrency } = require("./chitCalculations");

const getMemberFinancialSummary = async (db, chit, memberId) => {
  const [payments] = await db.query(
    `
      SELECT installment_number, payment_status, late_fee, amount_paid, amount_due, paid_at
      FROM payments
      WHERE chit_id = ? AND member_id = ?
      ORDER BY installment_number ASC
    `,
    [chit.chit_id, memberId]
  );

  const dueInstallmentCount = getDueInstallmentCount(chit.start_date, chit.duration_months);
  const paidInstallments = new Set(
    payments
      .filter((payment) => ["PAID_ON_TIME", "LATE_PAYMENT"].includes(payment.payment_status))
      .map((payment) => Number(payment.installment_number))
  );
  const unpaidInstallments = [];

  for (let installment = 1; installment <= dueInstallmentCount; installment += 1) {
    if (!paidInstallments.has(installment)) {
      unpaidInstallments.push(installment);
    }
  }

  const onTimeCount = payments.filter((payment) => payment.payment_status === "PAID_ON_TIME").length;
  const latePaymentCount = payments.filter(
    (payment) => payment.payment_status === "LATE_PAYMENT"
  ).length;
  const penaltyTotal = roundCurrency(
    payments.reduce((total, payment) => total + Number(payment.late_fee || 0), 0)
  );
  const pendingDues = roundCurrency(unpaidInstallments.length * Number(chit.monthly_installment));
  const unpaidCount = unpaidInstallments.length;

  return {
    payments,
    dueInstallmentCount,
    unpaidInstallments,
    onTimeCount,
    latePaymentCount,
    unpaidCount,
    pendingDues,
    penaltyTotal,
    isDefaulter: unpaidCount >= DEFAULT_DEFAULTER_MONTHS,
  };
};

const getChitFinancialOverview = async (db, chit, members) => {
  const [allPayments] = await db.query(
    `
      SELECT member_id, installment_number, payment_status, late_fee, amount_paid, amount_due, paid_at
      FROM payments
      WHERE chit_id = ?
      ORDER BY member_id, installment_number ASC
    `,
    [chit.chit_id]
  );

  const dueInstallmentCount = getDueInstallmentCount(chit.start_date, chit.duration_months);
  
  const paymentsByMember = allPayments.reduce((acc, p) => {
    if (!acc[p.member_id]) acc[p.member_id] = [];
    acc[p.member_id].push(p);
    return acc;
  }, {});

  const overview = members.map(member => {
    const memberId = member.member_id || member.user_id;
    const payments = paymentsByMember[memberId] || [];
    
    const paidInstallments = new Set(
      payments
        .filter(p => ["PAID_ON_TIME", "LATE_PAYMENT"].includes(p.payment_status))
        .map(p => Number(p.installment_number))
    );
    const unpaidInstallments = [];
    for (let i = 1; i <= dueInstallmentCount; i++) {
      if (!paidInstallments.has(i)) unpaidInstallments.push(i);
    }

    const onTimeCount = payments.filter(p => p.payment_status === "PAID_ON_TIME").length;
    const latePaymentCount = payments.filter(p => p.payment_status === "LATE_PAYMENT").length;
    const penaltyTotal = roundCurrency(payments.reduce((t, p) => t + Number(p.late_fee || 0), 0));
    const pendingDues = roundCurrency(unpaidInstallments.length * Number(chit.monthly_installment));
    const unpaidCount = unpaidInstallments.length;

    return {
      ...member,
      summary: {
        payments,
        dueInstallmentCount,
        unpaidInstallments,
        onTimeCount,
        latePaymentCount,
        unpaidCount,
        pendingDues,
        penaltyTotal,
        isDefaulter: unpaidCount >= DEFAULT_DEFAULTER_MONTHS,
      }
    };
  });

  return overview;
};

module.exports = {
  getMemberFinancialSummary,
  getChitFinancialOverview,
};
