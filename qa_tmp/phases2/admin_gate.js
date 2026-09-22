// Phase: admin review against new statuses + legacy endpoints + chit-join gate
const fs = require("fs");
const path = require("path");
const STATE2 = path.join(__dirname, "..", "state2.json");
const load2 = () => JSON.parse(fs.readFileSync(STATE2, "utf8"));
const save2 = (s) => fs.writeFileSync(STATE2, JSON.stringify(s, null, 2));

async function wizardCreate(L, adminTok, body) {
  return L.call("POST", "/chits/wizard/create", { token: adminTok, body });
}

module.exports = {
  async run(L) {
    const s2 = load2();
    const M = s2.members;
    const adminTok = s2.admin.token;

    // ---- queue authz ----
    const qMember = await L.call("GET", "/profile/admin/kyc-queue", { token: M.M2.token });
    L.T("ag", "queue-member-blocked", "member cannot read admin KYC queue (403)", qMember.status === 403, `status=${qMember.status}`);
    const q = await L.call("GET", "/profile/admin/kyc-queue", { token: adminTok });
    const list = Array.isArray(q.json) ? q.json : [];
    const rowM3 = list.find((r) => Number(r.user_id) === Number(M.M3.id));
    L.T("ag", "queue-lists-review", "queue lists REVIEW_REQUIRED member with masked data", q.status === 200 && !!rowM3 && rowM3.status === "REVIEW_REQUIRED" && /XXXX/.test(rowM3.aadhaar_number_masked || ""),
      `rows=${list.length} m3=${JSON.stringify(rowM3)}`);
    L.T("ag", "queue-masked-only", "queue exposes no hashes/document paths", !JSON.stringify(list).includes("hash") && !JSON.stringify(list).includes("id_document_path"), `fields=${rowM3 ? Object.keys(rowM3).join(",") : ""}`);

    // ---- approve M3 (reached REVIEW_REQUIRED via duplicate-Aadhaar path) ----
    const ap = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: rowM3.kyc_id, decision: "VERIFIED" } });
    const k3 = await L.dbOne("SELECT status, verified_by, verified_at FROM user_kyc WHERE user_id = ?", [M.M3.id]);
    const u3 = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [M.M3.id]);
    const h3 = await L.dbq("SELECT action_type, status FROM user_kyc_history WHERE user_id = ?", [M.M3.id]);
    L.T("ag", "admin-approve", "admin approves REVIEW_REQUIRED -> VERIFIED", ap.status === 200 && k3.status === "VERIFIED" && Number(k3.verified_by) === Number(s2.admin.id) && !!k3.verified_at && u3.verification_status === "VERIFIED" && h3.some((x) => x.status === "VERIFIED"),
      `review=${ap.status} db=${JSON.stringify(k3)} users=${u3.verification_status} hist=${JSON.stringify(h3)}`);

    // ---- reject flow on a seeded REVIEW_REQUIRED row (M7) ----
    await L.dbq("UPDATE user_kyc SET status='REVIEW_REQUIRED', reason_code='QA_SEEDED' WHERE user_id = ?", [M.M7.id]);
    const k7row = await L.dbOne("SELECT kyc_id FROM user_kyc WHERE user_id = ?", [M.M7.id]);
    const rejNoReason = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: k7row.kyc_id, decision: "REJECTED" } });
    L.T("ag", "reject-no-reason", "reject without reason -> 400", rejNoReason.status === 400, `status=${rejNoReason.status} msg=${rejNoReason.json && rejNoReason.json.message}`);
    const rej = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: k7row.kyc_id, decision: "REJECTED", rejectionReason: "QA re-test rejection reason" } });
    const k7 = await L.dbOne("SELECT status, rejection_reason FROM user_kyc WHERE user_id = ?", [M.M7.id]);
    const u7 = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [M.M7.id]);
    const st7 = await L.call("GET", "/profile/kyc/status", { token: M.M7.token });
    L.T("ag", "admin-reject", "admin rejects with reason -> REJECTED + reason + member-visible", rej.status === 200 && k7.status === "REJECTED" && /QA re-test/.test(k7.rejection_reason) && u7.verification_status === "REJECTED" && st7.json.kyc.rejection_reason === k7.rejection_reason,
      `review=${rej.status} db=${JSON.stringify(k7)} users=${u7.verification_status}`);
    const q2 = await L.call("GET", "/profile/admin/kyc-queue", { token: adminTok });
    L.T("ag", "queue-cleared", "reviewed members leave the queue", !(q2.json || []).some((r) => [M.M3.id, M.M7.id].map(Number).includes(Number(r.user_id))), `remaining=${(q2.json || []).length}`);
    const badDecision = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: k7row.kyc_id, decision: "APPROVED" } });
    L.T("ag", "review-bad-decision", "invalid decision value -> 400", badDecision.status === 400, `status=${badDecision.status}`);
    const ghost = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: 99999999, decision: "VERIFIED" } });
    L.T("ag", "review-ghost", "non-existent kycId -> 404", ghost.status === 404, `status=${ghost.status}`);
    const memberReview = await L.call("POST", "/profile/admin/review-kyc", { token: M.M2.token, body: { kycId: k7row.kyc_id, decision: "VERIFIED" } });
    L.T("ag", "review-member-blocked", "member cannot call admin review (403)", memberReview.status === 403, `status=${memberReview.status}`);

    // ---- legacy endpoints ----
    const legacy = await L.call("POST", "/auth/kyc", { token: M.M4.token, body: { aadhar_number: M.M4.phone.slice(0, 12), pan_number: "LEGCY1234Z" } });
    const u4 = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [M.M4.id]);
    const k4 = await L.dbOne("SELECT COUNT(*) c FROM user_kyc WHERE user_id = ?", [M.M4.id]);
    L.T("ag", "legacy-auth-kyc", "legacy /auth/kyc still auto-verifies with NO user_kyc record (BUG persists)", legacy.status === 200 && u4.verification_status === "VERIFIED" && k4.c === 0,
      `status=${legacy.status} msg=${legacy.json && legacy.json.message} users=${u4.verification_status} kycRows=${k4.c}`);
    const legacyBad = await L.call("POST", "/auth/kyc", { token: M.M4.token, body: { aadhar_number: M.M4.phone.slice(0, 12), pan_number: "bad" } });
    L.T("ag", "legacy-badpan", "legacy invalid PAN -> 400", legacyBad.status === 400, `status=${legacyBad.status}`);

    const manual = await L.call("POST", "/profile/kyc", { token: M.M6.token, body: { pan_number: "MANUL1234Z", aadhaar_number: "512345678901" } });
    const k6 = await L.dbOne("SELECT COUNT(*) c FROM user_kyc WHERE user_id = ?", [M.M6.id]);
    L.T("ag", "legacy-manual-submit", "legacy manual POST /profile/kyc works with new status enum (expects 200)", manual.status === 200, `status=${manual.status} body=${JSON.stringify(manual.json)} kycRowAfter=${k6.c}`);

    // ---- chit gate by KYC status ----
    const g = await wizardCreate(L, adminTok, { group_name: "QA NewFlow Gate", type: "FIXED", chit_value: 120000, start_date: "2026-11-01", duration_months: 7, total_members: 7, monthly_due_date: 5, grace_period_days: 3, description: "QA new-flow gate" });
    const gid = g.json.chit_id;
    const order = ["M2", "M5", "M3", "M4", "M6", "M7", "M8"];
    const slots = order.map((t, i) => ({ assigned_month: i + 1, member_name: M[t].name, invitee_phone: M[t].phone }));
    const sl = await L.call("POST", "/chits/wizard/" + gid + "/slots", { token: adminTok, body: { slots } });
    L.T("ag", "gate-chit", "gate chit created with 7 invitations", (g.status === 201 || g.status === 200) && sl.status === 200, `chit=${gid} slots=${sl.status}`);
    const tokFor = async (phone) => (await L.dbOne("SELECT invitation_token FROM chit_invitations WHERE invitee_phone = ? AND chit_id = ?", [phone, gid])).invitation_token;
    const claims = {};
    for (const t of order) {
      const token = await tokFor(M[t].phone);
      const r = await L.call("POST", "/chits/claim-invite", { token: M[t].token, body: { token } });
      claims[t] = { status: r.status, body: r.json };
    }
    const kycStates = {};
    for (const t of order) {
      const row = await L.dbOne("SELECT status FROM user_kyc WHERE user_id = ?", [M[t].id]);
      const u = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [M[t].id]);
      kycStates[t] = `${row ? row.status : "NO_ROW"}/users:${u.verification_status}`;
    }
    L.T("ag", "gate-verified-join", "VERIFIED members join (M2, M5, M3)", ["M2", "M5", "M3"].every((t) => claims[t].status === 200), `M2=${claims.M2.status} M5=${claims.M5.status} M3=${claims.M3.status}`);
    L.T("ag", "gate-legacy-fake-verified-blocked", "legacy-verified user with NO user_kyc row blocked (M4)", claims.M4.status === 403, `status=${claims.M4.status} state=${kycStates.M4} body=${JSON.stringify(claims.M4.body)}`);
    L.T("ag", "gate-not-started-blocked", "NOT_STARTED member blocked (M6)", claims.M6.status === 403, `status=${claims.M6.status} state=${kycStates.M6}`);
    L.T("ag", "gate-rejected-blocked", "REJECTED member blocked (M7)", claims.M7.status === 403, `status=${claims.M7.status} state=${kycStates.M7}`);
    L.T("ag", "gate-in-progress-blocked", "IN_PROGRESS member blocked (M8)", claims.M8.status === 403, `status=${claims.M8.status} state=${kycStates.M8}`);
    const members = await L.dbq("SELECT member_id FROM chit_members WHERE chit_id = ?", [gid]);
    const got = members.map((m) => Number(m.member_id)).sort((a, b) => a - b);
    const exp = [M.M2.id, M.M5.id, M.M3.id].map(Number).sort((a, b) => a - b);
    L.T("ag", "gate-members-db", "only the 3 VERIFIED members are members in DB", JSON.stringify(got) === JSON.stringify(exp), `got=${JSON.stringify(got)}`);
    const blockedRows = await L.dbOne("SELECT COUNT(*) c FROM chit_members WHERE chit_id = ? AND member_id IN (?,?,?,?)", [gid, M.M4.id, M.M6.id, M.M7.id, M.M8.id]);
    L.T("ag", "gate-blocked-no-rows", "no membership rows for blocked members", blockedRows.c === 0, "count=" + blockedRows.c);

    // ---- audit gap precision: duplicate review path ----
    const dupAudit = await L.dbOne("SELECT COUNT(*) c FROM audit_logs WHERE reference_id = ? AND action_type = 'KYC_REVIEW_REQUIRED'", [M.M3.id]);
    L.T("ag", "duplicate-audit-gap", "duplicate-Aadhaar review path wrote NO KYC_REVIEW_REQUIRED audit (gap)", dupAudit.c === 0, "count=" + dupAudit.c);

    s2.chit = { gate: gid };
    save2(s2);
  },
};
