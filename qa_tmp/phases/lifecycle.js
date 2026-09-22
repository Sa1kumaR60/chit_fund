// Phase: admin queue/review, approve + reject lifecycle, member visibility, persistence
module.exports = {
  async run(L) {
    const state = L.loadState();
    const A = state.members.A, B = state.members.B, D = state.members.D, E = state.members.E;
    const adminTok = state.admin.token;
    if (!state.kycIds) throw new Error("run kyc_submit first");

    // ---- Queue access control ----
    let qAsMember = await L.call("GET", "/profile/admin/kyc-queue", { token: A.token });
    L.T("life", "queue-member", "member blocked from admin queue", qAsMember.status === 403, `status=${qAsMember.status} msg=${qAsMember.json && qAsMember.json.message}`);
    let qAsAdmin = await L.call("GET", "/profile/admin/kyc-queue", { token: adminTok });
    const queue = qAsAdmin.json || [];
    const inQueue = queue.some((x) => Number(x.kyc_id) === Number(state.kycIds.A)) && queue.some((x) => Number(x.kyc_id) === Number(state.kycIds.D)) && queue.some((x) => Number(x.kyc_id) === Number(state.kycIds.E));
    const qMaskedOk = queue.every((x) => /^[A-Z]{5}\*{4}[A-Z]$/.test(x.pan_number_masked) && /^XXXX-XXXX-\d{4}$/.test(x.aadhaar_number_masked));
    const qNoHashes = queue.every((x) => !("pan_number_hash" in x) && !("aadhaar_number_hash" in x) && !("id_document_path" in x));
    L.T("life", "queue-admin", "admin sees pending queue incl A,D,E", qAsAdmin.status === 200 && inQueue, `status=${qAsAdmin.status} queueSize=${queue.length}`);
    L.T("life", "queue-masked", "queue shows masked PAN/Aadhaar only", qMaskedOk, "checked");
    L.T("life", "queue-no-internals", "queue excludes hashes/paths", qNoHashes, "checked");
    const qItemA = queue.find((x) => Number(x.kyc_id) === Number(state.kycIds.A));
    L.T("life", "queue-ident", "queue identifies member (name/phone/email)", !!qItemA && !!qItemA.name && !!qItemA.phone && !!qItemA.email, `name=${qItemA && qItemA.name}`);

    // review access control by member
    let revAsMember = await L.call("POST", "/profile/admin/review-kyc", { token: A.token, body: { kycId: state.kycIds.A, decision: "VERIFIED" } });
    L.T("life", "review-member", "member blocked from review endpoint", revAsMember.status === 403, `status=${revAsMember.status}`);

    // invalid decisions
    let badDec = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: state.kycIds.A, decision: "APPROVED" } });
    L.T("life", "review-bad-decision", "invalid decision rejected", badDec.status === 400, `status=${badDec.status} msg=${badDec.json && badDec.json.message}`);
    let noId = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { decision: "VERIFIED" } });
    L.T("life", "review-no-id", "missing kycId rejected", noId.status === 400, `status=${noId.status}`);
    let ghost = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: 999999, decision: "VERIFIED" } });
    L.T("life", "review-ghost", "nonexistent kyc -> 404", ghost.status === 404, `status=${ghost.status}`);

    // ---- Approve A ----
    let apA = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: state.kycIds.A, decision: "VERIFIED" } });
    const kycA = await L.dbOne("SELECT * FROM user_kyc WHERE user_id = ?", [A.id]);
    const uA = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [A.id]);
    const histA = await L.dbq("SELECT * FROM user_kyc_history WHERE user_id = ? ORDER BY performed_at DESC", [A.id]);
    const notifA = await L.dbq("SELECT * FROM notifications WHERE user_id = ? AND type='KYC_STATUS'", [A.id]);
    const auditV = await L.dbq("SELECT * FROM audit_logs WHERE action_type='KYC_VERIFIED' AND reference_id=?", [A.id]);
    L.T("life", "approve-A", "admin approves A", apA.status === 200, `status=${apA.status} msg=${apA.json && apA.json.message}`);
    L.T("life", "approve-A-db", "user_kyc VERIFIED + verifier + time", kycA.status === "VERIFIED" && Number(kycA.verified_by) === state.admin.id && !!kycA.verified_at, `status=${kycA.status} by=${kycA.verified_by}`);
    L.T("life", "approve-A-user", "users.verification_status=VERIFIED", uA.verification_status === "VERIFIED", `got=${uA.verification_status}`);
    L.T("life", "approve-A-history", "history VERIFIED entry w/ admin actor", histA[0].action_type === "VERIFIED" && Number(histA[0].performed_by) === state.admin.id, `top=${histA[0] && histA[0].action_type}`);
    L.T("life", "approve-A-notif", "member notified KYC_STATUS", notifA.length >= 1, `count=${notifA.length}`);
    L.T("life", "approve-A-audit", "audit KYC_VERIFIED", auditV.length === 1, `count=${auditV.length}`);
    // queue no longer contains A
    let q2 = await L.call("GET", "/profile/admin/kyc-queue", { token: adminTok });
    L.T("life", "queue-after-approve", "approved A leaves pending queue", !(q2.json || []).some((x) => Number(x.kyc_id) === Number(state.kycIds.A)), `queue=${(q2.json || []).length}`);

    // Member sees updated status (+ re-login persistence)
    const gkA = await L.call("GET", "/profile/kyc", { token: A.token });
    L.T("life", "A-sees-verified", "member A sees VERIFIED", gkA.json && gkA.json.kyc && gkA.json.kyc.status === "VERIFIED", `got=${gkA.json && gkA.json.kyc && gkA.json.kyc.status}`);
    const reLogin = await L.call("POST", "/auth/login", { body: { phone: A.phone, password: A.password } });
    const gkA2 = await L.call("GET", "/profile/kyc", { token: reLogin.json.token });
    L.T("life", "A-relogin", "status persists after re-login", gkA2.json && gkA2.json.kyc && gkA2.json.kyc.status === "VERIFIED", `got=${gkA2.json && gkA2.json.kyc && gkA2.json.kyc.status}`);

    // ---- B: reject flow ----
    let bSub = await L.call("POST", "/profile/kyc", { token: B.token, body: { pan_number: B.pan, aadhaar_number: B.aadhaar } });
    const kycBrow = await L.dbOne("SELECT kyc_id FROM user_kyc WHERE user_id = ?", [B.id]);
    state.kycIds.B = kycBrow.kyc_id;
    let rejNoReason = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: state.kycIds.B, decision: "REJECTED" } });
    L.T("life", "B-reject-no-reason", "rejection without reason rejected", rejNoReason.status === 400, `status=${rejNoReason.status} msg=${rejNoReason.json && rejNoReason.json.message}`);
    let rej = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: state.kycIds.B, decision: "REJECTED", rejectionReason: "QA synthetic test rejection" } });
    const kycB = await L.dbOne("SELECT * FROM user_kyc WHERE user_id = ?", [B.id]);
    const uB = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [B.id]);
    L.T("life", "B-reject", "admin rejects B with reason", rej.status === 200, `status=${rej.status} msg=${rej.json && rej.json.message}`);
    L.T("life", "B-reject-db", "user_kyc REJECTED + reason stored", kycB.status === "REJECTED" && kycB.rejection_reason === "QA synthetic test rejection", `status=${kycB.status} reason=${kycB.rejection_reason}`);
    L.T("life", "B-reject-user", "users.verification_status=REJECTED", uB.verification_status === "REJECTED", `got=${uB.verification_status}`);
    const gkB = await L.call("GET", "/profile/kyc", { token: B.token });
    L.T("life", "B-sees-rejected", "member B sees REJECTED + reason", gkB.json && gkB.json.kyc && gkB.json.kyc.status === "REJECTED" && gkB.json.kyc.rejection_reason, `got=${gkB.json && gkB.json.kyc && gkB.json.kyc.status} reason=${gkB.json && gkB.json.kyc && gkB.json.kyc.rejection_reason}`);

    // ---- B resubmits after rejection ----
    let bRe = await L.call("POST", "/profile/kyc", { token: B.token, body: { pan_number: B.pan, aadhaar_number: B.aadhaar } });
    const kycB2 = await L.dbOne("SELECT * FROM user_kyc WHERE user_id = ?", [B.id]);
    const histB = await L.dbq("SELECT * FROM user_kyc_history WHERE user_id = ? ORDER BY performed_at DESC", [B.id]);
    L.T("life", "B-resubmit", "rejected member can resubmit -> PENDING", bRe.status === 200 && kycB2.status === "PENDING" && kycB2.rejection_reason === null, `status=${bRe.status} kyc=${kycB2.status} reason=${kycB2.rejection_reason}`);
    L.T("life", "B-resubmit-hist", "history marks resubmission (expect SUBMITTED or RESUBMITTED)", ["SUBMITTED", "RESUBMITTED"].includes(histB[0].action_type), `top=${histB[0].action_type} (note: enum has RESUBMITTED)`);
    // approve B after resubmission
    let apB = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: state.kycIds.B, decision: "VERIFIED" } });
    const uB2 = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [B.id]);
    L.T("life", "B-approve-after-resubmit", "admin approves resubmitted B", apB.status === 200 && uB2.verification_status === "VERIFIED", `status=${apB.status} users=${uB2.verification_status}`);

    // ---- E (exe-pdf doc) approve, D approve ----
    let apE = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: state.kycIds.E, decision: "VERIFIED" } });
    let apD = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: state.kycIds.D, decision: "VERIFIED" } });
    const uE = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [E.id]);
    L.T("life", "E-approve", "admin can approve doc without viewing content (UI gap note)", apE.status === 200 && uE.verification_status === "VERIFIED", `status=${apE.status}`);
    L.T("life", "D-approve", "D approved", apD.status === 200, `status=${apD.status}`);

    // ---- VERIFIED member downgrades own status by resubmitting (finding) ----
    const newPan = L.synthPan("QPLXY"); const newAd = L.synthAadhaar();
    let aRe = await L.call("POST", "/profile/kyc", { token: A.token, body: { pan_number: newPan, aadhaar_number: newAd } });
    const kycA3 = await L.dbOne("SELECT status FROM user_kyc WHERE user_id = ?", [A.id]);
    const uA3 = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [A.id]);
    L.T("life", "A-self-downgrade", "VERIFIED member can resubmit -> back to PENDING (finding)", aRe.status === 200 && kycA3.status === "PENDING" && uA3.verification_status === "PENDING",
      `status=${aRe.status} kyc=${kycA3.status} users=${uA3.verification_status}`);
    // restore A verified for chit tests
    const kycA4 = await L.dbOne("SELECT kyc_id FROM user_kyc WHERE user_id = ?", [A.id]);
    state.kycIds.A = kycA4.kyc_id;
    let apA2 = await L.call("POST", "/profile/admin/review-kyc", { token: adminTok, body: { kycId: state.kycIds.A, decision: "VERIFIED" } });
    L.T("life", "A-reapproved", "A re-approved VERIFIED", apA2.status === 200, `status=${apA2.status}`);

    L.saveState(state);
  },
};
