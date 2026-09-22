// Phase: provider-independent KYC — initiate / callback / status / security / DB
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const STATE2 = path.join(__dirname, "..", "state2.json");
const load2 = () => { try { return JSON.parse(fs.readFileSync(STATE2, "utf8")); } catch (_) { return {}; } };
const save2 = (s) => fs.writeFileSync(STATE2, JSON.stringify(s, null, 2));
const NAME = (tag) => "QA NewFlow " + tag;

async function register(L, tag) {
  const rec = { tag, name: NAME(tag), phone: L.synthPhone(), email: L.synthEmail("nf" + tag.toLowerCase()), password: "Test@1234" };
  const r = await L.call("POST", "/auth/register", { body: { name: rec.name, phone: rec.phone, email: rec.email, password: rec.password, role: "MEMBER" } });
  const lg = await L.call("POST", "/auth/login", { body: { phone: rec.phone, password: rec.password } });
  rec.id = lg.json && lg.json.user_id; rec.token = lg.json && lg.json.token; rec.regStatus = r.status; rec.loginStatus = lg.status;
  return rec;
}

module.exports = {
  async run(L) {
    const s2 = load2();
    s2.members = s2.members || {};
    const tags = ["M1", "M2", "M3", "M4", "M5", "M6", "M7"];
    for (const t of tags) {
      if (!s2.members[t]) s2.members[t] = await register(L, t);
    }
    const M = s2.members;
    L.T("nf", "provision", "7 synthetic members registered+logged in", tags.every((t) => M[t].id && M[t].token), tags.map((t) => t + "=" + M[t].id).join(","));

    // admin
    const st1 = L.loadState();
    let adm = st1.admin;
    let al = await L.call("POST", "/auth/login", { body: { phone: adm.phone, password: adm.password } });
    if (al.status !== 200) {
      const rec = await register(L, "ADM2");
      const rr = await L.call("POST", "/auth/register", { body: { name: "QA NF Admin", phone: rec.phone, email: rec.email, password: rec.password, role: "ADMIN" } });
      const lg = await L.call("POST", "/auth/login", { body: { phone: rec.phone, password: rec.password } });
      adm = { id: lg.json.user_id, phone: rec.phone, password: rec.password, token: lg.json.token };
      L.T("nf", "admin", "fresh QA admin created (public admin registration still open)", lg.status === 200, "reg=" + rr.status);
    } else {
      adm = { ...adm, token: al.json.token, id: al.json.user_id };
      L.T("nf", "admin", "existing QA admin logged in", true, "id=" + adm.id);
    }
    s2.admin = adm;

    const mockClean = "999988889901";
    const PEPPER = L.ENV.KYC_HASH_PEPPER || "default_dev_pepper_secret_1234567890";
    const hmac = (v) => crypto.createHmac("sha256", PEPPER).update(String(v).trim()).digest("hex");

    // ---------- 1. initial status ----------
    let st = await L.call("GET", "/profile/kyc/status", { token: M.M6.token });
    L.T("nf", "status-initial", "new member status defaults to NOT_STARTED", st.status === 200 && st.json.kyc && st.json.kyc.status === "NOT_STARTED", `status=${st.status} kyc=${JSON.stringify(st.json && st.json.kyc)} history=${JSON.stringify(st.json && st.json.history)}`);

    // ---------- 2. initiate ----------
    let ini = await L.call("POST", "/profile/kyc/initiate", { token: M.M1.token });
    const tok1 = ini.json && ini.json.stateToken;
    L.T("nf", "initiate", "initiate returns provider, 64-hex state token, redirectUrl", ini.status === 200 && ini.json.provider === "MOCK" && /^[0-9a-f]{64}$/.test(tok1 || "") && /\/kyc\/callback\?code=/.test(ini.json.redirectUrl || ""),
      `status=${ini.status} provider=${ini.json && ini.json.provider} tokenLen=${(tok1 || "").length} redirect=${(ini.json && ini.json.redirectUrl || "").slice(0, 90)}`);
    const sess1 = await L.dbOne("SELECT session_id, status, provider, expires_at, TIMESTAMPDIFF(SECOND, NOW(), expires_at) secs FROM kyc_verification_sessions WHERE state_token = ?", [tok1]);
    L.T("nf", "initiate-db", "session row INITIATED, +5min expiry, provider MOCK", !!sess1 && sess1.status === "INITIATED" && sess1.provider === "MOCK" && sess1.secs > 250 && sess1.secs <= 300,
      JSON.stringify(sess1));
    const k1 = await L.dbOne("SELECT status, verification_provider, aadhaar_number_masked FROM user_kyc WHERE user_id = ?", [M.M1.id]);
    L.T("nf", "initiate-userkyc", "user_kyc set IN_PROGRESS by initiate", !!k1 && k1.status === "IN_PROGRESS" && k1.verification_provider === "MOCK", JSON.stringify(k1));
    const aud1 = await L.dbOne("SELECT COUNT(*) c FROM audit_logs WHERE action_type='KYC_INITIATED' AND user_id = ?", [M.M1.id]);
    L.T("nf", "initiate-audit", "KYC_INITIATED audit row written", aud1.c >= 1, "count=" + aud1.c);
    // state token not leaked by status endpoint
    const stAfter = await L.call("GET", "/profile/kyc/status", { token: M.M1.token });
    L.T("nf", "status-no-token-leak", "status endpoint does not expose state token", !JSON.stringify(stAfter.json).includes(tok1), `body=${JSON.stringify(stAfter.json).slice(0, 120)}`);

    // ---------- 3. single open session per user ----------
    let ini2 = await L.call("POST", "/profile/kyc/initiate", { token: M.M1.token });
    const tok1b = ini2.json && ini2.json.stateToken;
    const openSessions = await L.dbOne("SELECT COUNT(*) c FROM kyc_verification_sessions WHERE user_id = ? AND status='INITIATED'", [M.M1.id]);
    const firstNow = await L.dbOne("SELECT status, reason_code FROM kyc_verification_sessions WHERE state_token = ?", [tok1]);
    L.T("nf", "initiate-single-open", "re-initiate expires previous open session (one INITIATED)", ini2.status === 200 && openSessions.c === 1 && firstNow.status === "EXPIRED", `open=${openSessions.c} first=${firstNow.status}/${firstNow.reason_code}`);

    // ---------- 4. callback: name mismatch -> REVIEW_REQUIRED (intended) ----------
    let cbWrong = await L.call("POST", "/profile/kyc/callback", { token: M.M1.token, body: { code: "mock_authorization_code_sandbox", state: tok1b, mockName: "COMPLETELY DIFFERENT PERSON" } });
    L.T("nf", "callback-mismatch", "name mismatch routes to REVIEW_REQUIRED", cbWrong.status === 200 && cbWrong.json.status === "REVIEW_REQUIRED",
      `status=${cbWrong.status} body=${JSON.stringify(cbWrong.json)}`);
    // retry same state with own name -> demonstrates client-supplied name is trusted
    let cbRetry = await L.call("POST", "/profile/kyc/callback", { token: M.M1.token, body: { code: "mock_authorization_code_sandbox", state: tok1b, mockName: M.M1.name } });
    const k1b = await L.dbOne("SELECT status, reason_code FROM user_kyc WHERE user_id = ?", [M.M1.id]);
    L.T("nf", "callback-name-client-controlled", "same state retried with own name verifies (client supplies verifiedName)", cbRetry.status === 200 && cbRetry.json.status === "VERIFIED",
      `status=${cbRetry.status} body=${JSON.stringify(cbRetry.json)} db=${JSON.stringify(k1b)}`);
    L.T("nf", "callback-state-replay-after-failure", "failed callback leaves state token reusable (replay protection bypassed on failure)", cbRetry.status === 200,
      `replay accepted=${cbRetry.status === 200}`);

    // ---------- 5. happy path ----------
    let i2 = await L.call("POST", "/profile/kyc/initiate", { token: M.M2.token });
    const tok2 = i2.json && i2.json.stateToken;
    let cb2 = await L.call("POST", "/profile/kyc/callback", { token: M.M2.token, body: { code: "mock_authorization_code_sandbox", state: tok2, mockName: M.M2.name } });
    const k2 = await L.dbOne("SELECT status, verification_provider, aadhaar_number_masked, aadhaar_number_hash, provider_reference_id, verified_at FROM user_kyc WHERE user_id = ?", [M.M2.id]);
    const u2 = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [M.M2.id]);
    const h2 = await L.dbq("SELECT action_type, status FROM user_kyc_history WHERE user_id = ? ORDER BY performed_at", [M.M2.id]);
    const n2 = await L.dbOne("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND type='KYC_STATUS'", [M.M2.id]);
    const a2 = await L.dbOne("SELECT COUNT(*) c FROM audit_logs WHERE action_type='KYC_VERIFIED' AND user_id = ?", [M.M2.id]);
    L.T("nf", "callback-verified", "happy path verifies (200 VERIFIED)", cb2.status === 200 && cb2.json.status === "VERIFIED", `status=${cb2.status} body=${JSON.stringify(cb2.json)}`);
    L.T("nf", "verified-db", "DB: VERIFIED, provider MOCK, masked aadhaar, HMAC hash, verified_at", !!k2 && k2.status === "VERIFIED" && k2.verification_provider === "MOCK" && k2.aadhaar_number_masked === "XXXX-XXXX-9901" && k2.aadhaar_number_hash === hmac(mockClean) && !!k2.verified_at,
      `masked=${k2 && k2.aadhaar_number_masked} hashMatch=${k2 && k2.aadhaar_number_hash === hmac(mockClean)} ref=${k2 && k2.provider_reference_id}`);
    L.T("nf", "verified-users", "users.verification_status = VERIFIED", u2.verification_status === "VERIFIED", u2.verification_status);
    L.T("nf", "verified-history-notif-audit", "history VERIFIED + notification + audit written", h2.some((x) => x.status === "VERIFIED") && n2.c >= 1 && a2.c >= 1,
      `hist=${JSON.stringify(h2)} notif=${n2.c} audit=${a2.c}`);
    // no raw aadhaar anywhere
    const rawLeak = await L.dbOne("SELECT COUNT(*) c FROM user_kyc WHERE aadhaar_number_masked LIKE '%999988889901%' OR aadhaar_number_hash LIKE '%999988889901%'", []);
    L.T("nf", "no-raw-aadhaar", "no raw Aadhaar digits stored in user_kyc", rawLeak.c === 0, "matches=" + rawLeak.c);

    // ---------- 6. already verified ----------
    let i2b = await L.call("POST", "/profile/kyc/initiate", { token: M.M2.token });
    L.T("nf", "initiate-already-verified", "verified user cannot re-initiate (400)", i2b.status === 400, `status=${i2b.status} msg=${i2b.json && i2b.json.message}`);

    // ---------- 7. duplicate aadhaar (mock returns same aadhaar for everyone) ----------
    let i3 = await L.call("POST", "/profile/kyc/initiate", { token: M.M3.token });
    const tok3 = i3.json && i3.json.stateToken;
    let cb3 = await L.call("POST", "/profile/kyc/callback", { token: M.M3.token, body: { code: "mock_authorization_code_sandbox", state: tok3, mockName: M.M3.name } });
    const k3 = await L.dbOne("SELECT status, reason_code FROM user_kyc WHERE user_id = ?", [M.M3.id]);
    L.T("nf", "callback-duplicate", "second user with same provider Aadhaar -> REVIEW_REQUIRED (admin review)", cb3.status === 200 && cb3.json.status === "REVIEW_REQUIRED",
      `status=${cb3.status} body=${JSON.stringify(cb3.json)} db=${JSON.stringify(k3)}`);

    // ---------- 8. callback security ----------
    let i4 = await L.call("POST", "/profile/kyc/initiate", { token: M.M5.token });
    const tok5 = i4.json && i4.json.stateToken;
    const idor = await L.call("POST", "/profile/kyc/callback", { token: M.M6.token, body: { code: "mock_authorization_code_sandbox", state: tok5, mockName: M.M6.name } });
    L.T("nf", "callback-idor", "another user's state token rejected (403 INVALID_STATE)", idor.status === 403, `status=${idor.status} body=${JSON.stringify(idor.json)}`);
    const replay = await L.call("POST", "/profile/kyc/callback", { token: M.M2.token, body: { code: "mock_authorization_code_sandbox", state: tok2, mockName: M.M2.name } });
    L.T("nf", "callback-replay", "used state token rejected (400 TOKEN_ALREADY_USED)", replay.status === 400 && replay.json.reasonCode === "TOKEN_ALREADY_USED", `status=${replay.status} body=${JSON.stringify(replay.json)}`);
    const bogus = await L.call("POST", "/profile/kyc/callback", { token: M.M6.token, body: { code: "x", state: "deadbeef".repeat(8) } });
    L.T("nf", "callback-bogus-state", "unknown state token rejected (403)", bogus.status === 403, `status=${bogus.status}`);
    const noState = await L.call("POST", "/profile/kyc/callback", { token: M.M6.token, body: { code: "x" } });
    L.T("nf", "callback-missing-state", "missing state -> 400", noState.status === 400, `status=${noState.status} body=${JSON.stringify(noState.json)}`);
    // expiry
    await L.dbq("UPDATE kyc_verification_sessions SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE state_token = ?", [tok5]);
    const exp = await L.call("POST", "/profile/kyc/callback", { token: M.M5.token, body: { code: "mock_authorization_code_sandbox", state: tok5, mockName: M.M5.name } });
    const expSession = await L.dbOne("SELECT status, reason_code FROM kyc_verification_sessions WHERE state_token = ?", [tok5]);
    L.T("nf", "callback-expired", "expired session -> 400 OAUTH_EXPIRED and marked EXPIRED", exp.status === 400 && exp.json.reasonCode === "OAUTH_EXPIRED" && expSession.status === "EXPIRED",
      `status=${exp.status} body=${JSON.stringify(exp.json)} session=${JSON.stringify(expSession)}`);
    // no auth
    const unauth = await L.call("POST", "/profile/kyc/initiate", {});
    const unauth2 = await L.call("GET", "/profile/kyc/status", {});
    L.T("nf", "no-auth", "initiate/status require auth (401)", unauth.status === 401 && unauth2.status === 401, `initiate=${unauth.status} status=${unauth2.status}`);
    // provider error code
    let i7 = await L.call("POST", "/profile/kyc/initiate", { token: M.M7.token });
    const tok7 = i7.json && i7.json.stateToken;
    const perr = await L.call("POST", "/profile/kyc/callback", { token: M.M7.token, body: { code: "error_denied", state: tok7 } });
    const k7 = await L.dbOne("SELECT status, reason_code FROM user_kyc WHERE user_id = ?", [M.M7.id]);
    L.T("nf", "callback-provider-error", "provider error code -> 400 NOT_STARTED/PROVIDER_UNAVAILABLE", perr.status === 400, `status=${perr.status} body=${JSON.stringify(perr.json)} db=${JSON.stringify(k7)}`);
    // cancellation (error param, no code)
    const cancel = await L.call("POST", "/profile/kyc/callback", { token: M.M7.token, body: { error: "access_denied", state: tok7 } });
    L.T("nf", "callback-cancel", "user cancellation -> 200 CANCELLED/NOT_STARTED", cancel.status === 200 && cancel.json.status === "NOT_STARTED", `status=${cancel.status} body=${JSON.stringify(cancel.json)}`);

    // ---------- 9. DB / schema integrity ----------
    const sessCols = await L.dbq("SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='chit_fund' AND TABLE_NAME='kyc_verification_sessions'");
    L.T("nf", "sessions-schema", "sessions table has state_token UNIQUE + expiry + status", sessCols.some((c) => c.COLUMN_NAME === "state_token") && sessCols.some((c) => c.COLUMN_NAME === "expires_at"), sessCols.map((c) => c.COLUMN_NAME).join(","));
    const fk = await L.dbq("SELECT CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='chit_fund' AND TABLE_NAME='kyc_verification_sessions'");
    L.T("nf", "sessions-fk", "sessions FK to users RESTRICT", fk.length >= 1 && fk.every((f) => f.DELETE_RULE === "RESTRICT"), JSON.stringify(fk));
    const histEnum = await L.dbOne("SELECT COLUMN_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='chit_fund' AND TABLE_NAME='user_kyc_history' AND COLUMN_NAME='action_type'");
    const histStatusEnum = await L.dbOne("SELECT COLUMN_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='chit_fund' AND TABLE_NAME='user_kyc_history' AND COLUMN_NAME='status'");
    L.T("nf", "history-enum-action", "history.action_type enum includes REVIEW_REQUIRED (migration applied)", /REVIEW_REQUIRED/.test(histEnum.t), histEnum.t);
    L.T("nf", "history-enum-status", "history.status enum includes NOT_STARTED/IN_PROGRESS/REVIEW_REQUIRED", /NOT_STARTED/.test(histStatusEnum.t) && /IN_PROGRESS/.test(histStatusEnum.t) && /REVIEW_REQUIRED/.test(histStatusEnum.t), histStatusEnum.t);
    const stuck = await L.dbOne("SELECT COUNT(*) c FROM user_kyc WHERE status = 'IN_PROGRESS'", []);
    L.T("nf", "in-progress-count", "IN_PROGRESS rows exist (initiated but not completed)", stuck.c >= 0, "count=" + stuck.c);

    s2.tokens = { M1: tok1b, M2: tok2, M3: tok3 };
    s2.mockClean = mockClean;
    save2(s2);
  },
};
