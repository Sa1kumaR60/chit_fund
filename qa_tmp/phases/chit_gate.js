// Phase: chit join gating by KYC state + membership association + token-steal behavior
async function wizardCreate(L, adminTok, body) {
  return L.call("POST", "/chits/wizard/create", { token: adminTok, body });
}
async function setSlots(L, adminTok, chitId, slots) {
  return L.call("POST", "/chits/wizard/" + chitId + "/slots", { token: adminTok, body: { slots } });
}

module.exports = {
  async run(L) {
    const state = L.loadState();
    const A = state.members.A, B = state.members.B, C = state.members.C, D = state.members.D, E = state.members.E, F = state.members.F;
    const adminTok = state.admin.token;

    // ---------- Chit G1 : gate by KYC state ----------
    const g1 = await wizardCreate(L, adminTok, {
      group_name: "QA KYC Gate 1", type: "FIXED", chit_value: 100000, start_date: "2026-10-01",
      duration_months: 4, total_members: 4, monthly_due_date: 5, grace_period_days: 3, description: "QA synthetic gate chit",
    });
    L.T("chit", "g1-create", "admin creates gate chit G1", g1.status === 201 || g1.status === 200, `status=${g1.status} id=${g1.json && g1.json.chit_id}`);
    const g1id = g1.json.chit_id;
    const slotsRes = await setSlots(L, adminTok, g1id, [
      { assigned_month: 1, member_name: "M A", invitee_phone: A.phone },
      { assigned_month: 2, member_name: "M C", invitee_phone: C.phone },
      { assigned_month: 3, member_name: "M F", invitee_phone: F.phone },
      { assigned_month: 4, member_name: "M B", invitee_phone: B.phone },
    ]);
    L.T("chit", "g1-slots", "G1 slots/invitations configured", slotsRes.status === 200, `status=${slotsRes.status} msg=${slotsRes.json && slotsRes.json.message}`);

    async function tokenFor(phone) {
      const row = await L.dbOne("SELECT invitation_token FROM chit_invitations WHERE invitee_phone = ? AND status='PENDING' ORDER BY invitation_id DESC LIMIT 1", [phone]);
      return row ? row.invitation_token : null;
    }
    const tA = await tokenFor(A.phone); const tC = await tokenFor(C.phone); const tF = await tokenFor(F.phone); const tB = await tokenFor(B.phone);
    L.T("chit", "tokens", "invitation tokens issued for all", !!(tA && tC && tF && tB), "len=" + (tA || "").length);

    // C: NO user_kyc row (users.verification_status=VERIFIED via legacy endpoint) -> must be blocked
    let c1 = await L.call("POST", "/chits/claim-invite", { token: C.token, body: { token: tC } });
    L.T("chit", "C-no-kyc-row", "no-KYC-record member blocked even with valid token", c1.status === 403 && c1.json && c1.json.kycRequired === true, `status=${c1.status} msg=${c1.json && c1.json.message}`);

    // F: user_kyc PENDING -> blocked
    let f1 = await L.call("POST", "/chits/claim-invite", { token: F.token, body: { token: tF } });
    L.T("chit", "F-pending", "PENDING-KYC member blocked", f1.status === 403, `status=${f1.status} kycRequired=${f1.json && f1.json.kycRequired}`);

    // F: admin REJECTS -> claim still blocked
    const kycF = await L.dbOne("SELECT kyc_id FROM user_kyc WHERE user_id = ?", [F.id]);
    const rejF = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: kycF.kyc_id, decision: "REJECTED", rejectionReason: "QA gate test" } });
    let f2 = await L.call("POST", "/chits/claim-invite", { token: F.token, body: { token: tF } });
    L.T("chit", "F-rejected", "REJECTED-KYC member blocked", rejF.status === 200 && f2.status === 403, `review=${rejF.status} claim=${f2.status}`);

    // F: resubmit + approve -> claim succeeds
    await L.call("POST", "/profile/kyc", { token: F.token, body: { pan_number: F.pan, aadhaar_number: F.aadhaar } });
    const kycF2 = await L.dbOne("SELECT kyc_id FROM user_kyc WHERE user_id = ?", [F.id]);
    const apF = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: kycF2.kyc_id, decision: "VERIFIED" } });
    let f3 = await L.call("POST", "/chits/claim-invite", { token: F.token, body: { token: tF } });
    L.T("chit", "F-after-verify", "VERIFIED member joins after approval", apF.status === 200 && f3.status === 200, `review=${apF.status} claim=${f3.status} chitId=${f3.json && f3.json.chit_id}`);

    // A: VERIFIED -> joins
    let a1 = await L.call("POST", "/chits/claim-invite", { token: A.token, body: { token: tA } });
    L.T("chit", "A-verified", "VERIFIED member A joins", a1.status === 200, `status=${a1.status} chitId=${a1.json && a1.json.chit_id}`);
    // B: VERIFIED -> joins
    let b1 = await L.call("POST", "/chits/claim-invite", { token: B.token, body: { token: tB } });
    L.T("chit", "B-verified", "VERIFIED member B joins", b1.status === 200, `status=${b1.status}`);

    // DB membership assertions
    const membersG1 = await L.dbq("SELECT member_id, assigned_month FROM chit_members WHERE chit_id = ? ORDER BY member_id", [g1id]);
    const inG1 = membersG1.map((m) => Number(m.member_id));
    const expect = [A.id, B.id, F.id].map(Number).sort((x, y) => x - y);
    const got = inG1.slice().sort((x, y) => x - y);
    L.T("chit", "g1-members-db", "G1 memberships = A,B,F only (C excluded)", JSON.stringify(got) === JSON.stringify(expect), `got=${JSON.stringify(got)}`);
    const cMember = await L.dbOne("SELECT COUNT(*) c FROM chit_members WHERE chit_id = ? AND member_id = ?", [g1id, C.id]);
    L.T("chit", "g1-no-C", "C never became a member", cMember.c === 0, `count=${cMember.c}`);
    // invitations updated
    const invA = await L.dbOne("SELECT status, user_id FROM chit_invitations WHERE invitee_phone = ? AND chit_id = ?", [A.phone, g1id]);
    const invC = await L.dbOne("SELECT status, user_id FROM chit_invitations WHERE invitee_phone = ? AND chit_id = ?", [C.phone, g1id]);
    L.T("chit", "g1-inv-status", "A invitation ACCEPTED, C still PENDING", invA.status === "ACCEPTED" && Number(invA.user_id) === A.id && invC.status === "PENDING", `A=${invA.status} C=${invC.status}`);

    // ---------- Chit G2 : token-steal behavior (bearer-token semantics) ----------
    const g2 = await wizardCreate(L, adminTok, {
      group_name: "QA KYC Gate 2", type: "FIXED", chit_value: 50000, start_date: "2026-11-01",
      duration_months: 2, total_members: 2, monthly_due_date: 5, grace_period_days: 3, description: "QA synthetic token chit",
    });
    const g2id = g2.json.chit_id;
    await setSlots(L, adminTok, g2id, [
      { assigned_month: 1, member_name: "M A2", invitee_phone: A.phone },
      { assigned_month: 2, member_name: "M E", invitee_phone: E.phone },
    ]);
    const tA2 = await tokenFor(A.phone); // A's G2 token
    // D (VERIFIED, not the invitee) presents A's token
    let steal = await L.call("POST", "/chits/claim-invite", { token: D.token, body: { token: tA2 } });
    const membersG2 = await L.dbq("SELECT member_id FROM chit_members WHERE chit_id = ?", [g2id]);
    const g2m = membersG2.map((m) => Number(m.member_id));
    const invA2 = await L.dbOne("SELECT status, user_id FROM chit_invitations WHERE invitee_phone = ? AND chit_id = ?", [A.phone, g2id]);
    L.T("chit", "g2-token-steal", "verified non-invitee claiming invitee's token is accepted (documented behavior)", steal.status === 200 && g2m.includes(Number(D.id)) && invA2.status === "ACCEPTED" && Number(invA2.user_id) === D.id,
      `claim=${steal.status} members=${JSON.stringify(g2m)} invA2=${invA2.status} boundTo=${invA2.user_id}`);

    state.chits.gate1 = g1id;
    state.chits.gate2 = g2id;
    L.saveState(state);
  },
};
