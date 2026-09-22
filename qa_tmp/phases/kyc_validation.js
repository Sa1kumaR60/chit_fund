// Phase: KYC input validation / negative tests (B: expect NO row created; F: normalization-accept cases)
async function submitNeg(L, member, payload, label, expectStatus) {
  const before = await L.dbOne("SELECT COUNT(*) c FROM user_kyc WHERE user_id = ?", [member.id]);
  const res = await L.call("POST", "/profile/kyc", { token: member.token, body: payload });
  const after = await L.dbOne("SELECT COUNT(*) c FROM user_kyc WHERE user_id = ?", [member.id]);
  const rowSafe = before.c === after.c;
  L.T("kycval", label, label, res.status === expectStatus && rowSafe,
    `status=${res.status} (want ${expectStatus}) msg=${JSON.stringify(res.json && res.json.message)} rows=${before.c}->${after.c}`);
  return res;
}

module.exports = {
  async run(L) {
    const state = L.loadState();
    const B = state.members.B, F = state.members.F;
    if (!B || !F) throw new Error("provision first");

    // 1. No token
    let r = await L.call("POST", "/profile/kyc", { body: { pan_number: B.pan, aadhaar_number: B.aadhaar } });
    L.T("kycval", "no-token", "submit without token rejected", r.status === 401, `status=${r.status} msg=${r.json && r.json.message}`);

    // 2. Empty / partial / malformed payloads (must NOT create rows)
    await submitNeg(L, B, {}, "empty-body", 400);
    await submitNeg(L, B, { aadhaar_number: B.aadhaar }, "missing-pan", 400);
    await submitNeg(L, B, { pan_number: B.pan }, "missing-aadhaar", 400);
    await submitNeg(L, B, { pan_number: "", aadhaar_number: "" }, "empty-strings", 400);
    await submitNeg(L, B, { pan_number: "   ", aadhaar_number: "    " }, "whitespace-only", 400);
    await submitNeg(L, B, { pan_number: "ABCDE1234", aadhaar_number: B.aadhaar }, "pan-9chars", 400);
    await submitNeg(L, B, { pan_number: "ABCDE1234FG", aadhaar_number: B.aadhaar }, "pan-11chars", 400);
    await submitNeg(L, B, { pan_number: "AAAAAAAAAA", aadhaar_number: B.aadhaar }, "pan-all-letters", 400);
    await submitNeg(L, B, { pan_number: B.pan, aadhaar_number: "12345678901" }, "aadhaar-11digits", 400);
    await submitNeg(L, B, { pan_number: B.pan, aadhaar_number: "12345678901A" }, "aadhaar-letters", 400);
    await submitNeg(L, B, { pan_number: "A".repeat(10000), aadhaar_number: B.aadhaar }, "pan-10k", 400);
    await submitNeg(L, B, { pan_number: B.pan, aadhaar_number: "9".repeat(10000) }, "aadhaar-10k", 400);
    // 3. Injection / XSS payloads
    await submitNeg(L, B, { pan_number: "ABCDE1234F' OR '1'='1", aadhaar_number: B.aadhaar }, "sqli-pan", 400);
    await submitNeg(L, B, { pan_number: B.pan, aadhaar_number: "123456789012' OR '1'='1" }, "sqli-aadhaar", 400);
    await submitNeg(L, B, { pan_number: "ABCDE1234F; DROP TABLE users;--", aadhaar_number: B.aadhaar }, "sqli-pan2", 400);
    await submitNeg(L, B, { pan_number: "<script>alert(1)</script>", aadhaar_number: B.aadhaar }, "xss-pan", 400);
    await submitNeg(L, B, { pan_number: B.pan, aadhaar_number: '"><img src=x onerror=alert(1)>' }, "xss-aadhaar", 400);

    // 4. Wrong method / wrong content type
    const rawRes = await L.call("POST", "/profile/kyc", { token: B.token, raw: true, headers: { "Content-Type": "text/plain" }, body: "pan_number=AAAAA1234A&aadhaar_number=123456789012" });
    L.T("kycval", "form-body", "form-encoded body handled", [400, 200].includes(rawRes.status), `status=${rawRes.status} msg=${(rawRes.text || "").slice(0, 80)}`);
    let m1 = await L.call("PUT", "/profile/kyc", { token: B.token, body: {} });
    let m2 = await L.call("DELETE", "/profile/kyc", { token: B.token });
    L.T("kycval", "put-method", "PUT /profile/kyc not allowed", m1.status === 404, `status=${m1.status}`);
    L.T("kycval", "delete-method", "DELETE /profile/kyc not allowed", m2.status === 404, `status=${m2.status}`);

    // 5. B must remain row-free & PENDING
    const row = await L.dbOne("SELECT COUNT(*) c FROM user_kyc WHERE user_id = ?", [B.id]);
    const u = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [B.id]);
    L.T("kycval", "no-row", "negative tests left no KYC row for B", row.c === 0 && u.verification_status === "PENDING", `rows=${row.c} users.status=${u.verification_status}`);

    // 6. Normalization-accept cases on F (lowercase PAN, spaced Aadhaar) - design check
    let lc = await L.call("POST", "/profile/kyc", { token: F.token, body: { pan_number: F.pan.toLowerCase(), aadhaar_number: F.aadhaar } });
    L.T("kycval", "lowercase-pan", "lowercase PAN accepted & normalized", lc.status === 200, `status=${lc.status}`);
    let sp = await L.call("POST", "/profile/kyc", { token: F.token, body: { pan_number: F.pan, aadhaar_number: F.aadhaar.slice(0, 4) + " " + F.aadhaar.slice(4, 8) + " " + F.aadhaar.slice(8) } });
    L.T("kycval", "aadhaar-spaces", "aadhaar with spaces accepted & normalized", sp.status === 200, `status=${sp.status}`);
    const fRow = await L.dbOne("SELECT pan_number_masked, aadhaar_number_masked FROM user_kyc WHERE user_id = ?", [F.id]);
    L.T("kycval", "normalized-db", "normalized values stored masked correctly", !!fRow && fRow.pan_number_masked === F.pan.slice(0, 5) + "****" + F.pan.slice(9), `masked=${fRow && fRow.pan_number_masked}`);

    L.saveState(state);
  },
};
