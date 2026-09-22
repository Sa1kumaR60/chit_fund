// Phase: correct re-test of legacy endpoints + PAN-collection check + no-bypass proof
const fs = require("fs");
const path = require("path");
const STATE2 = path.join(__dirname, "..", "state2.json");
const load2 = () => JSON.parse(fs.readFileSync(STATE2, "utf8"));

module.exports = {
  async run(L) {
    const s2 = load2();
    const M = s2.members;
    const adminTok = s2.admin.token;

    // ---- legacy /auth/kyc with a valid 12-digit synthetic Aadhaar ----
    const aad = "7" + String(Math.floor(10000000000 + Math.random() * 89999999999));
    const pan = "LEGCY" + String(Math.floor(1000 + Math.random() * 9000)) + "Q";
    const before = await L.dbOne("SELECT COUNT(*) c FROM user_kyc WHERE user_id = ?", [M.M4.id]);
    const legacy = await L.call("POST", "/auth/kyc", { token: M.M4.token, body: { aadhar_number: aad, pan_number: pan } });
    const u4 = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [M.M4.id]);
    const after = await L.dbOne("SELECT COUNT(*) c FROM user_kyc WHERE user_id = ?", [M.M4.id]);
    const hist4 = await L.dbOne("SELECT COUNT(*) c FROM user_kyc_history WHERE user_id = ?", [M.M4.id]);
    const aud4 = await L.dbOne("SELECT COUNT(*) c FROM audit_logs WHERE reference_id = ? AND action_type LIKE 'KYC_%'", [M.M4.id]);
    L.T("lg", "legacy-auto-verify", "legacy /auth/kyc returns 200 and sets users.verification_status=VERIFIED", legacy.status === 200 && u4.verification_status === "VERIFIED", `status=${legacy.status} msg=${legacy.json && legacy.json.message} users=${u4.verification_status}`);
    L.T("lg", "legacy-no-record", "legacy auto-verify creates NO user_kyc row / history / audit (BUG persists)", after.c === before.c && hist4.c === 0 && aud4.c === 0, `kycRows ${before.c}->${after.c} hist=${hist4.c} audit=${aud4.c}`);
    // status endpoint still reports NOT_STARTED for a legacy-verified user (inconsistency)
    const st4 = await L.call("GET", "/profile/kyc/status", { token: M.M4.token });
    L.T("lg", "legacy-vs-status", "profile KYC tab reports NOT_STARTED while users table says VERIFIED (inconsistency)", st4.json.kyc.status === "NOT_STARTED" && u4.verification_status === "VERIFIED", `tab=${st4.json.kyc.status} users=${u4.verification_status}`);

    // ---- legacy-verified user still cannot join the gate chit ----
    const gid = s2.chit.gate;
    const inv = await L.dbOne("SELECT invitation_token, status FROM chit_invitations WHERE invitee_phone = ? AND chit_id = ?", [M.M4.phone, gid]);
    const claim = await L.call("POST", "/chits/claim-invite", { token: M.M4.token, body: { token: inv.invitation_token } });
    const mem = await L.dbOne("SELECT COUNT(*) c FROM chit_members WHERE chit_id = ? AND member_id = ?", [gid, M.M4.id]);
    L.T("lg", "legacy-cannot-bypass-gate", "legacy-verified (no user_kyc row) still blocked from joining", claim.status === 403 && mem.c === 0, `claim=${claim.status} memberRows=${mem.c} invitation=${inv.status}`);
    L.T("lg", "legacy-remains-fake-verified", "no verification was actually performed (no provider, no session)", true, "documented");

    // ---- legacy manual submit leaves DB unchanged (transaction rollback) ----
    const snapBefore = await L.dbOne("SELECT status FROM user_kyc WHERE user_id = ?", [M.M6.id]);
    const manual = await L.call("POST", "/profile/kyc", { token: M.M6.token, body: { pan_number: "MANUL1234Z", aadhaar_number: "512345678901" } });
    const snapAfter = await L.dbOne("SELECT status, pan_number_masked FROM user_kyc WHERE user_id = ?", [M.M6.id]);
    L.T("lg", "manual-submit-broken", "legacy manual POST /profile/kyc fails with enum truncation (500)", manual.status === 500 && /Data truncated for column 'status'/.test(manual.json && manual.json.message || ""),
      `status=${manual.status} msg=${manual.json && manual.json.message}`);
    L.T("lg", "manual-submit-no-mutation", "failed manual submit rolls back (no partial write)", snapBefore.status === snapAfter.status && snapAfter.pan_number_masked === null, `${snapBefore.status} -> ${snapAfter.status}, panMasked=${snapAfter.pan_number_masked}`);

    // ---- legacy manual submit also broken for a member with no row ----
    const aad3 = "6" + String(Math.floor(10000000000 + Math.random() * 89999999999));
    const manual2 = await L.call("POST", "/profile/kyc", { token: M.M8.token, body: { pan_number: "MNULX1234Z", aadhaar_number: aad3 } });
    L.T("lg", "manual-submit-insert-broken", "manual submit INSERT path also fails (enum 'PENDING' removed)", manual2.status === 500, `status=${manual2.status} msg=${manual2.json && manual2.json.message}`);

    // ---- PAN no longer collected/verified in the new flow ----
    const m2row = await L.dbOne("SELECT pan_number_masked, pan_number_hash, aadhaar_number_masked FROM user_kyc WHERE user_id = ?", [M.M2.id]);
    L.T("lg", "pan-not-collected", "new flow verifies Aadhaar only; PAN is never captured (null)", m2row.pan_number_masked === null && m2row.pan_number_hash === null, JSON.stringify(m2row));
    const anyMasked = await L.dbOne("SELECT COUNT(*) c FROM user_kyc WHERE status='VERIFIED' AND aadhaar_number_masked LIKE 'XXXX%'", []);
    L.T("lg", "verified-masked-format", "verified rows carry properly masked Aadhaar", anyMasked.c >= 1, "count=" + anyMasked.c);
  },
};
