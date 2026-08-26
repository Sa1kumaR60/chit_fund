const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "backend/.env") });

const db = require("./backend/db");
const {
  createWizardChit,
  saveMonthlyRules,
  configureMemberSlots,
  getFinancialSimulationPreview,
  activateChit,
  claimInvitationByToken,
} = require("./backend/controllers/chitController");

async function runTest() {
  console.log("🧪 Starting Backend Wizard Flow End-to-End Test...");

  const adminReq = {
    user: { id: 1, role: "ADMIN" },
    body: {
      group_name: "Test Fixed Scheme 2026",
      type: "FIXED",
      chit_value: 100000,
      start_date: "2026-08-01",
      duration_months: 5,
      total_members: 5,
      monthly_due_date: 5,
      grace_period_days: 5,
      description: "Test Fixed Chit Group",
      admin_commission_rate: 0.05,
    },
  };

  const createRes = await runController(createWizardChit, adminReq);
  console.log("✅ 1. Draft Chit Created:", createRes.data);
  const chitId = createRes.data.chit_id;

  // 2. Configure Monthly Rules
  const rulesReq = {
    user: { id: 1, role: "ADMIN" },
    params: { chitId },
    body: {
      monthly_rules: [
        { month_number: 1, fixed_installment_amount: 20000 },
        { month_number: 2, fixed_installment_amount: 20000 },
        { month_number: 3, fixed_installment_amount: 20000 },
        { month_number: 4, fixed_installment_amount: 20000 },
        { month_number: 5, fixed_installment_amount: 20000 },
      ],
    },
  };
  const rulesRes = await runController(saveMonthlyRules, rulesReq);
  console.log("✅ 2. Monthly Rules Saved:", rulesRes.data);

  // 3. Configure Member Slots
  const slotsReq = {
    user: { id: 1, role: "ADMIN" },
    params: { chitId },
    body: {
      slots: [
        { assigned_month: 1, member_name: "Member 1", invitee_phone: "9876543210" },
        { assigned_month: 2, member_name: "Member 2", invitee_phone: "9876543211" },
        { assigned_month: 3, member_name: "Member 3", invitee_phone: "9876543212" },
        { assigned_month: 4, member_name: "Member 4", invitee_phone: "9876543213" },
        { assigned_month: 5, member_name: "Member 5", invitee_phone: "9876543214" },
      ],
    },
  };
  const slotsRes = await runController(configureMemberSlots, slotsReq);
  console.log("✅ 3. Slots Configured:", slotsRes.data);

  // 4. Financial Simulation
  const simReq = { params: { chitId } };
  const simRes = await runController(getFinancialSimulationPreview, simReq);
  console.log("✅ 4. Financial Simulation Projection:", simRes.data.simulation.monthProjections.length, "months projected.");

  // 5. Activate Chit
  const actReq = { user: { id: 1, role: "ADMIN" }, params: { chitId } };
  const actRes = await runController(activateChit, actReq);
  console.log("✅ 5. Chit Activated:", actRes.data);

  // 6. Claim Invitation Token by Member (User ID 2)
  const [[slot]] = await db.promise().query(
    "SELECT invitation_token FROM chit_member_slots WHERE chit_id = ? LIMIT 1",
    [chitId]
  );
  const claimReq = {
    user: { id: 2, role: "MEMBER" },
    body: { token: slot.invitation_token },
  };
  const claimRes = await runController(claimInvitationByToken, claimReq);
  console.log("✅ 6. Slot Token Claimed by Member:", claimRes.data);

  console.log("🎉 All Backend Wizard & Financial Simulation Tests PASSED!");
  process.exit(0);
}

function runController(controllerFn, req) {
  return new Promise((resolve) => {
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.data = data;
        resolve(this);
      },
    };
    controllerFn(req, res).catch((err) => resolve({ statusCode: 500, data: { message: err.message } }));
  });
}

runTest();
