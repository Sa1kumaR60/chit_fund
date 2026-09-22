// Phase: valid KYC submission, duplicate handling, document uploads & streaming authorization
function b64(s) { return Buffer.from(s, "utf8").toString("base64"); }
function asDataUrl(s) { return "data:application/octet-stream;base64," + b64(s); }

module.exports = {
  async run(L) {
    const state = L.loadState();
    const A = state.members.A, C = state.members.C, D = state.members.D, E = state.members.E;
    if (!A || !C || !D || !E) throw new Error("provision first");

    // ---- A: valid submit (no document) ----
    let r = await L.call("POST", "/profile/kyc", { token: A.token, body: { pan_number: A.pan, aadhaar_number: A.aadhaar } });
    L.T("kycsub", "A-valid", "A valid KYC submit", r.status === 200, `status=${r.status} msg=${r.json && r.json.message}`);

    // DB checks for A
    const kycA = await L.dbOne("SELECT * FROM user_kyc WHERE user_id = ?", [A.id]);
    const uA = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [A.id]);
    const histA = await L.dbq("SELECT * FROM user_kyc_history WHERE user_id = ? ORDER BY performed_at", [A.id]);
    const auditA = await L.dbq("SELECT * FROM audit_logs WHERE reference_type='USER' AND reference_id=? AND action_type='KYC_SUBMITTED'", [A.id]);
    L.T("kycsub", "A-row", "user_kyc row created PENDING", !!kycA && kycA.status === "PENDING", `status=${kycA && kycA.status}`);
    L.T("kycsub", "A-user-status", "users.verification_status=PENDING", uA.verification_status === "PENDING", `got=${uA.verification_status}`);
    L.T("kycsub", "A-masked-pan", "PAN stored masked ABCDE****F", kycA && /^[A-Z]{5}\*{4}[A-Z]$/.test(kycA.pan_number_masked), `masked=${kycA && kycA.pan_number_masked}`);
    L.T("kycsub", "A-masked-aadhaar", "Aadhaar stored masked XXXX-XXXX-1234", kycA && /^XXXX-XXXX-\d{4}$/.test(kycA.aadhaar_number_masked), `masked=${kycA && kycA.aadhaar_number_masked}`);
    L.T("kycsub", "A-hash-pan", "PAN hash = SHA-256 of PAN", kycA && kycA.pan_number_hash === L.sha256(A.pan), "match");
    L.T("kycsub", "A-hash-aadhaar", "Aadhaar hash = SHA-256 of Aadhaar", kycA && kycA.aadhaar_number_hash === L.sha256(A.aadhaar), "match");
    L.T("kycsub", "A-history", "history SUBMITTED entry exists", histA.length === 1 && histA[0].action_type === "SUBMITTED" && histA[0].status === "PENDING" && Number(histA[0].performed_by) === A.id,
      `count=${histA.length} action=${histA[0] && histA[0].action_type}`);
    L.T("kycsub", "A-audit", "audit log KYC_SUBMITTED exists", auditA.length === 1, `count=${auditA.length}`);
    L.T("kycsub", "A-no-raw-pii", "no raw PAN/Aadhaar in DB (masked+hash only columns)", !("pan_number" in kycA) && !("aadhaar_number" in kycA), "ok");

    // ---- A resubmit (idempotency / duplicate row check) ----
    await new Promise((r) => setTimeout(r, 1100));
    const kycIdA = kycA.kyc_id;
    let r2 = await L.call("POST", "/profile/kyc", { token: A.token, body: { pan_number: A.pan, aadhaar_number: A.aadhaar } });
    const kycAResub = await L.dbOne("SELECT * FROM user_kyc WHERE user_id = ?", [A.id]);
    const countA = (await L.dbOne("SELECT COUNT(*) c FROM user_kyc WHERE user_id = ?", [A.id])).c;
    const histACount = (await L.dbOne("SELECT COUNT(*) c FROM user_kyc_history WHERE user_id = ?", [A.id])).c;
    L.T("kycsub", "A-resubmit", "resubmit OK single row (upsert)", r2.status === 200 && countA === 1 && kycAResub.kyc_id === kycIdA, `status=${r2.status} rows=${countA} sameId=${kycAResub.kyc_id === kycIdA}`);
    L.T("kycsub", "A-resubmit-history", "resubmit appends history entry", histACount === 2, `history=${histACount}`);

    // ---- duplicate PAN/Aadhaar across users (C) ----
    let d1 = await L.call("POST", "/profile/kyc", { token: C.token, body: { pan_number: A.pan, aadhaar_number: C.aadhaar } });
    L.T("kycsub", "dup-pan", "duplicate PAN across accounts rejected", d1.status === 400, `status=${d1.status} msg=${d1.json && d1.json.message}`);
    let d2 = await L.call("POST", "/profile/kyc", { token: C.token, body: { pan_number: C.pan, aadhaar_number: A.aadhaar } });
    L.T("kycsub", "dup-aadhaar", "duplicate Aadhaar across accounts rejected", d2.status === 400, `status=${d2.status} msg=${d2.json && d2.json.message}`);
    const cRow = await L.dbOne("SELECT COUNT(*) c FROM user_kyc WHERE user_id = ?", [C.id]);
    L.T("kycsub", "dup-no-row", "no row created for C", cRow.c === 0, `rows=${cRow.c}`);

    // ---- D: valid submit WITH pdf document ----
    const pdfContent = "%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF QA FAKE PDF";
    let dRes = await L.call("POST", "/profile/kyc", { token: D.token, body: { pan_number: D.pan, aadhaar_number: D.aadhaar, id_document_base64: asDataUrl(pdfContent), document_name: "identity-proof.pdf" } });
    const kycD = await L.dbOne("SELECT * FROM user_kyc WHERE user_id = ?", [D.id]);
    const fs = require("fs");
    const fileOk = kycD && fs.existsSync(kycD.id_document_path);
    L.T("kycsub", "D-pdf", "valid pdf upload accepted", dRes.status === 200 && fileOk, `status=${dRes.status} file=${kycD && kycD.id_document_path} exists=${fileOk}`);
    state.kycIds = state.kycIds || {};
    state.kycIds.A = kycA.kyc_id; state.kycIds.D = kycD.kyc_id;

    // ---- E: document security ----
    // invalid extension .exe
    let e1 = await L.call("POST", "/profile/kyc", { token: E.token, body: { pan_number: E.pan, aadhaar_number: E.aadhaar, id_document_base64: asDataUrl("MZ\x90\x00binary"), document_name: "malware.exe" } });
    L.T("kycsub", "E-exe-ext", "executable extension rejected (expect clean 4xx)", e1.status === 400, `status=${e1.status} msg=${e1.json && e1.json.message}`);
    // html ext
    let e2 = await L.call("POST", "/profile/kyc", { token: E.token, body: { pan_number: E.pan, aadhaar_number: E.aadhaar, id_document_base64: asDataUrl("<html><script>alert(1)</script></html>"), document_name: "page.html" } });
    L.T("kycsub", "E-html-ext", "html extension rejected (expect clean 4xx)", e2.status === 400, `status=${e2.status} msg=${e2.json && e2.json.message}`);
    const eRowAfterBad = await L.dbOne("SELECT COUNT(*) c FROM user_kyc WHERE user_id = ?", [E.id]);
    L.T("kycsub", "E-no-row-bad-ext", "no row after rejected ext", eRowAfterBad.c === 0, `rows=${eRowAfterBad.c}`);
    // exe bytes renamed .pdf (content spoof)
    let e3 = await L.call("POST", "/profile/kyc", { token: E.token, body: { pan_number: E.pan, aadhaar_number: E.aadhaar, id_document_base64: asDataUrl("MZ\x90\x00EXE-BYTES-NOT-PDF"), document_name: "document.pdf" } });
    const kycE = await L.dbOne("SELECT * FROM user_kyc WHERE user_id = ?", [E.id]);
    L.T("kycsub", "E-exe-as-pdf", "exe bytes as .pdf accepted (content not validated - finding)", e3.status === 200 && !!kycE, `status=${e3.status} stored=${kycE && kycE.id_document_path}`);
    state.kycIds.E = kycE && kycE.kyc_id;
    // path traversal attempt in name
    let e4 = await L.call("POST", "/profile/kyc", { token: E.token, body: { pan_number: E.pan, aadhaar_number: E.aadhaar, id_document_base64: asDataUrl("junk"), document_name: "..\\..\\..\\windows\\evil.pdf" } });
    const kycE2 = await L.dbOne("SELECT id_document_path FROM user_kyc WHERE user_id = ?", [E.id]);
    const safePath = kycE2 && /kyc-doc-[0-9a-f]{32}\.pdf$/.test(kycE2.id_document_path) && !kycE2.id_document_path.includes("..") && !kycE2.id_document_path.includes("windows");
    L.T("kycsub", "E-traversal", "path traversal neutralized (random name, whitelist ext)", e4.status === 200 && safePath, `status=${e4.status} path=${kycE2 && kycE2.id_document_path}`);
    // oversized file (~1.05 MB)
    const big = Buffer.alloc(1050 * 1024, 0x41).toString("base64");
    let e5 = await L.call("POST", "/profile/kyc", { token: E.token, body: { pan_number: E.pan, aadhaar_number: E.aadhaar, id_document_base64: big, document_name: "big.pdf" } });
    L.T("kycsub", "E-oversize", "oversized upload (>1MB) rejected", e5.status === 413, `status=${e5.status} msg=${(e5.text || "").slice(0, 120)}`);

    // ---- Document streaming & IDOR ----
    const ownDoc = await L.call("GET", "/profile/kyc/document/" + state.kycIds.E, { token: E.token });
    L.T("kycsub", "doc-owner", "owner streams own doc", ownDoc.status === 200, `status=${ownDoc.status} ct=${ownDoc.headers["content-type"]}`);
    const idor = await L.call("GET", "/profile/kyc/document/" + state.kycIds.E, { token: A.token });
    L.T("kycsub", "doc-idor", "other member cannot stream doc (IDOR blocked)", idor.status === 403, `status=${idor.status} msg=${idor.json && idor.json.message}`);
    const noTok = await L.call("GET", "/profile/kyc/document/" + state.kycIds.E, {});
    L.T("kycsub", "doc-notoken", "no token cannot stream doc", noTok.status === 401, `status=${noTok.status}`);
    const adminDoc = await L.call("GET", "/profile/kyc/document/" + state.kycIds.E, { token: state.admin.token });
    L.T("kycsub", "doc-admin", "admin can stream any doc", adminDoc.status === 200, `status=${adminDoc.status}`);
    const ghost = await L.call("GET", "/profile/kyc/document/999999", { token: A.token });
    L.T("kycsub", "doc-ghost", "nonexistent kyc doc -> 404", ghost.status === 404, `status=${ghost.status}`);

    // ---- API response field exposure ----
    const gk = await L.call("GET", "/profile/kyc", { token: A.token });
    const k = (gk.json && gk.json.kyc) || {};
    const keys = Object.keys(k);
    L.T("kycsub", "A-getkyc-keys", "GET /profile/kyc returns masked + no hash/path", gk.status === 200 && !("pan_number_hash" in k) && !("aadhaar_number_hash" in k) && !("id_document_path" in k) && ("pan_number_masked" in k),
      `keys=${keys.join(",")}`);
    L.T("kycsub", "A-getkyc-status", "GET /profile/kyc status PENDING", k.status === "PENDING", `status=${k.status}`);

    L.saveState(state);
  },
};
