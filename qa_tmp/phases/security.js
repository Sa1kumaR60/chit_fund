// Phase: auth-token abuse, legacy auto-verify endpoint, role-forgery resistance
const jwt = require("C:/Users/saiku/OneDrive/Desktop/chit_fund/backend/node_modules/jsonwebtoken");

module.exports = {
  async run(L) {
    const state = L.loadState();
    const A = state.members.A, Lmem = state.members.C;
    const adminTok = state.admin.token;
    const SECRET = L.ENV.JWT_SECRET;

    // ---- Legacy POST /api/auth/kyc ----
    let l1 = await L.call("POST", "/auth/kyc", { token: Lmem.token, body: { pan_number: "BADPAN", aadhaar_number: Lmem.aadhaar } });
    L.T("sec", "legacy-badpan", "legacy kyc invalid PAN rejected", l1.status === 400, `status=${l1.status}`);
    let l2 = await L.call("POST", "/auth/kyc", { body: { aadhar_number: Lmem.aadhaar, pan_number: Lmem.pan } });
    L.T("sec", "legacy-notoken", "legacy kyc without token rejected", l2.status === 401, `status=${l2.status}`);
    let l3 = await L.call("POST", "/auth/kyc", { token: Lmem.token, body: { aadhar_number: Lmem.aadhaar, pan_number: Lmem.pan } });
    const uL = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [Lmem.id]);
    const kycL = await L.dbOne("SELECT COUNT(*) c FROM user_kyc WHERE user_id = ?", [Lmem.id]);
    const histL = await L.dbOne("SELECT COUNT(*) c FROM user_kyc_history WHERE user_id = ?", [Lmem.id]);
    const auditL = await L.dbOne("SELECT COUNT(*) c FROM audit_logs WHERE action_type IN ('KYC_SUBMITTED','KYC_VERIFIED') AND reference_id = ?", [Lmem.id]);
    L.T("sec", "legacy-valid", "legacy kyc auto-verifies WITHOUT admin review (finding)", l3.status === 200 && uL.verification_status === "VERIFIED",
      `status=${l3.status} msg=${l3.json && l3.json.message} users.status=${uL.verification_status}`);
    L.T("sec", "legacy-no-record", "legacy kyc creates NO user_kyc/history/audit (finding)", kycL.c === 0 && histL.c === 0 && auditL.c === 0,
      `kycRows=${kycL.c} hist=${histL.c} audit=${auditL.c}`);
    const profL = await L.call("GET", "/profile", { token: Lmem.token });
    L.T("sec", "legacy-profile", "profile reports VERIFIED from legacy call", profL.json && profL.json.user && profL.json.user.verification_status === "VERIFIED",
      `got=${profL.json && profL.json.user && profL.json.user.verification_status}`);
    const qAfter = await L.call("GET", "/profile/admin/kyc-queue", { token: adminTok });
    const qHasL = (qAfter.json || []).some((x) => Number(x.user_id) === Number(Lmem.id));
    L.T("sec", "legacy-invisible-to-admin", "legacy-verified user absent from admin queue", !qHasL, "not in queue");

    // ---- Token abuse ----
    const me = await L.call("GET", "/profile", { token: A.token });
    L.T("sec", "tok-valid", "valid token works", me.status === 200, `status=${me.status}`);
    const noTok = await L.call("GET", "/profile", {});
    L.T("sec", "tok-missing", "missing token -> 401", noTok.status === 401, `status=${noTok.status} msg=${noTok.json && noTok.json.message}`);
    const badTok = await L.call("GET", "/profile", { token: "not.a.jwt" });
    L.T("sec", "tok-invalid", "invalid token -> 403", badTok.status === 403, `status=${badTok.status} msg=${badTok.json && badTok.json.message}`);
    const wrongSecret = jwt.sign({ id: A.id, role: "MEMBER", token_version: 0 }, "wrong-secret", { expiresIn: "1h" });
    const ws = await L.call("GET", "/profile", { token: wrongSecret });
    L.T("sec", "tok-wrong-secret", "token signed with wrong secret -> 403", ws.status === 403, `status=${ws.status}`);
    const expired = jwt.sign({ id: A.id, role: "MEMBER", token_version: 0 }, SECRET, { expiresIn: "-1h" });
    const ex = await L.call("GET", "/profile", { token: expired });
    L.T("sec", "tok-expired", "expired token -> 403", ex.status === 403, `status=${ex.status} msg=${ex.json && ex.json.message}`);
    const ghostUser = jwt.sign({ id: 999999, role: "MEMBER", token_version: 0 }, SECRET, { expiresIn: "1h" });
    const gu = await L.call("GET", "/profile", { token: ghostUser });
    L.T("sec", "tok-ghost-user", "token for deleted user -> 401", gu.status === 401, `status=${gu.status} msg=${gu.json && gu.json.message}`);
    const staleVer = jwt.sign({ id: A.id, role: "MEMBER", token_version: 999 }, SECRET, { expiresIn: "1h" });
    const sv = await L.call("GET", "/profile", { token: staleVer });
    L.T("sec", "tok-stale-version", "stale token_version -> 401 session revoked", sv.status === 401, `status=${sv.status} msg=${sv.json && sv.json.message}`);
    // role forgery in token: member claims ADMIN
    const forged = jwt.sign({ id: A.id, role: "ADMIN", token_version: 0 }, SECRET, { expiresIn: "1h" });
    const fq = await L.call("GET", "/profile/admin/kyc-queue", { token: forged });
    L.T("sec", "tok-role-forgery", "member cannot escalate via forged ADMIN role claim (DB role wins)", fq.status === 403, `status=${fq.status} msg=${fq.json && fq.json.message}`);
    const fRev = await L.call("POST", "/profile/admin/review-kyc", { token: forged, body: { kycId: state.kycIds.A, decision: "REJECTED", rejectionReason: "x" } });
    L.T("sec", "tok-role-forgery-review", "forged role cannot review KYC", fRev.status === 403, `status=${fRev.status}`);
    // re-check A was NOT rejected by the forged attempt
    const kycA = await L.dbOne("SELECT status FROM user_kyc WHERE kyc_id = ?", [state.kycIds.A]);
    L.T("sec", "forgery-no-effect", "A still VERIFIED after forged review attempt", kycA.status === "VERIFIED", `status=${kycA.status}`);

    L.saveState(state);
  },
};
