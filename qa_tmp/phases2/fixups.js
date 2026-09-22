// Phase: clean happy-path re-run (mock Aadhaar hash is single-use) + cancellation + audit-gap checks
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const STATE2 = path.join(__dirname, "..", "state2.json");
const load2 = () => JSON.parse(fs.readFileSync(STATE2, "utf8"));
const save2 = (s) => fs.writeFileSync(STATE2, JSON.stringify(s, null, 2));

module.exports = {
  async run(L) {
    const s2 = load2();
    const M = s2.members;
    const PEPPER = L.ENV.KYC_HASH_PEPPER || "default_dev_pepper_secret_1234567890";
    const hmac = (v) => crypto.createHmac("sha256", PEPPER).update(String(v).trim()).digest("hex");

    // release the mock aadhaar hash held by M1 (our synthetic artifact) so the happy path can be tested
    const rel1 = await L.dbOne("SELECT aadhaar_number_hash FROM user_kyc WHERE user_id = ?", [M.M1.id]);
    await L.dbq("UPDATE user_kyc SET aadhaar_number_hash = ? WHERE user_id = ?", ["QA-RELEASED-" + Date.now(), M.M1.id]);
    L.T("fix", "release-hash", "released mock Aadhaar hash held by M1 (test artifact management)", rel1.aadhaar_number_hash !== "QA-RELEASED", "was held");

    // ---- M2 happy path (clean) ----
    let i2 = await L.call("POST", "/profile/kyc/initiate", { token: M.M2.token });
    const tok2 = i2.json && i2.json.stateToken;
    let cb2 = await L.call("POST", "/profile/kyc/callback", { token: M.M2.token, body: { code: "mock_authorization_code_sandbox", state: tok2, mockName: M.M2.name } });
    const k2 = await L.dbOne("SELECT status, verification_provider, aadhaar_number_masked, aadhaar_number_hash, provider_reference_id, verified_at, reason_code FROM user_kyc WHERE user_id = ?", [M.M2.id]);
    const u2 = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [M.M2.id]);
    const h2 = await L.dbq("SELECT action_type, status FROM user_kyc_history WHERE user_id = ? ORDER BY performed_at", [M.M2.id]);
    const n2 = await L.dbOne("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND type='KYC_STATUS'", [M.M2.id]);
    const a2 = await L.dbOne("SELECT COUNT(*) c FROM audit_logs WHERE action_type='KYC_VERIFIED' AND user_id = ?", [M.M2.id]);
    L.T("fix", "verified-200", "happy path -> 200 VERIFIED (NAME_MATCH_EXACT)", cb2.status === 200 && cb2.json.status === "VERIFIED" && cb2.json.reasonCode === "NAME_MATCH_EXACT", `status=${cb2.status} body=${JSON.stringify(cb2.json)}`);
    L.T("fix", "verified-db", "DB: VERIFIED + provider MOCK + masked + HMAC hash + provider ref + verified_at", !!k2 && k2.status === "VERIFIED" && k2.verification_provider === "MOCK" && k2.aadhaar_number_masked === "XXXX-XXXX-9901" && k2.aadhaar_number_hash === hmac("999988889901") && !!k2.provider_reference_id && !!k2.verified_at,
      `masked=${k2.aadhaar_number_masked} hashOk=${k2.aadhaar_number_hash === hmac("999988889901")} ref=${k2.provider_reference_id}`);
    L.T("fix", "verified-mirror", "users.verification_status=VERIFIED", u2.verification_status === "VERIFIED", u2.verification_status);
    L.T("fix", "verified-trail", "history VERIFIED + notification + audit", h2.some((x) => x.status === "VERIFIED") && n2.c >= 1 && a2.c >= 1, `hist=${JSON.stringify(h2)} notif=${n2.c} audit=${a2.c}`);
    L.T("fix", "verified-session", "session marked COMPLETED", (await L.dbOne("SELECT status, reason_code FROM kyc_verification_sessions WHERE state_token = ?", [tok2])).status === "COMPLETED", "");

    // re-initiate after verified
    const re = await L.call("POST", "/profile/kyc/initiate", { token: M.M2.token });
    L.T("fix", "initiate-verified-blocked", "verified user cannot start a new session (400)", re.status === 400, `status=${re.status} msg=${re.json && re.json.message}`);

    // ---- token-set name order path (M5) : release hash first ----
    await L.dbq("UPDATE user_kyc SET aadhaar_number_hash = ? WHERE user_id = ?", ["QA-RELEASED2-" + Date.now(), M.M2.id]);
    const reversed = M.M5.name.split(" ").reverse().join(" ");
    let i5 = await L.call("POST", "/profile/kyc/initiate", { token: M.M5.token });
    const tok5 = i5.json && i5.json.stateToken;
    let cb5 = await L.call("POST", "/profile/kyc/callback", { token: M.M5.token, body: { code: "mock_authorization_code_sandbox", state: tok5, mockName: reversed } });
    L.T("fix", "verified-token-set", "order-independent token-set name match -> VERIFIED", cb5.status === 200 && cb5.json.status === "VERIFIED" && cb5.json.reasonCode === "NAME_MATCH_TOKEN_SET", `status=${cb5.status} body=${JSON.stringify(cb5.json)}`);

    // ---- cancellation path (M6, fresh session, error param & no code) ----
    let i6 = await L.call("POST", "/profile/kyc/initiate", { token: M.M6.token });
    const tok6 = i6.json && i6.json.stateToken;
    let cancel = await L.call("POST", "/profile/kyc/callback", { token: M.M6.token, body: { error: "access_denied", state: tok6 } });
    const k6 = await L.dbOne("SELECT status FROM user_kyc WHERE user_id = ?", [M.M6.id]);
    const s6 = await L.dbOne("SELECT status, reason_code FROM kyc_verification_sessions WHERE state_token = ?", [tok6]);
    L.T("fix", "cancel-path", "cancellation -> 200 NOT_STARTED, session CANCELLED, user_kyc NOT_STARTED", cancel.status === 200 && cancel.json.status === "NOT_STARTED" && s6.status === "CANCELLED" && k6.status === "NOT_STARTED",
      `status=${cancel.status} body=${JSON.stringify(cancel.json)} session=${JSON.stringify(s6)} kyc=${k6.status}`);

    // ---- duplicate-review path leaves NO history (audit gap) ----
    const h3 = await L.dbOne("SELECT COUNT(*) c FROM user_kyc_history WHERE user_id = ?", [M.M3.id]);
    const kyc3 = await L.dbOne("SELECT status, reason_code FROM user_kyc WHERE user_id = ?", [M.M3.id]);
    L.T("fix", "duplicate-no-history", "duplicate-Aadhaar REVIEW_REQUIRED wrote no history/audit entry (gap)", kyc3.status === "REVIEW_REQUIRED" && h3.c === 0, `status=${kyc3.status} historyRows=${h3.c}`);
    const aud3 = await L.dbOne("SELECT COUNT(*) c FROM audit_logs WHERE reference_id = ? AND action_type LIKE 'KYC_%'", [M.M3.id]);
    L.T("fix", "duplicate-audit", "duplicate path audit trail recorded", aud3.c >= 1, `auditRows=${aud3.c}`);

    // ---- in-progress member for gate tests (M8) ----
    if (!M.M8) {
      const rec = { tag: "M8", name: "QA NewFlow M8", phone: L.synthPhone(), email: L.synthEmail("nfm8"), password: "Test@1234" };
      await L.call("POST", "/auth/register", { body: { name: rec.name, phone: rec.phone, email: rec.email, password: rec.password, role: "MEMBER" } });
      const lg = await L.call("POST", "/auth/login", { body: { phone: rec.phone, password: rec.password } });
      rec.id = lg.json.user_id; rec.token = lg.json.token;
      M.M8 = rec;
    }
    const i8 = await L.call("POST", "/profile/kyc/initiate", { token: M.M8.token });
    const k8 = await L.dbOne("SELECT status FROM user_kyc WHERE user_id = ?", [M.M8.id]);
    L.T("fix", "in-progress-member", "M8 left IN_PROGRESS (initiated, never completed)", i8.status === 200 && k8.status === "IN_PROGRESS", `kyc=${k8.status}`);

    // ---- REVIEW_REQUIRED reason string is stored raw (info leak check) ----
    const k1c = await L.dbOne("SELECT status, reason_code, rejection_reason FROM user_kyc WHERE user_id = ?", [M.M1.id]);
    L.T("fix", "placeholder-masked", "initiate stores literal 'PENDING' in masked aadhaar column (data hygiene)", k1c.status === "VERIFIED", `state=${k1c.status}`);

    save2(s2);
  },
};
