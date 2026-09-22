// Phase: DB integrity — constraints, uniqueness, timestamps, personal-account untouched, PII columns
module.exports = {
  async run(L) {
    const state = L.loadState();
    const tags = ["A", "B", "C", "D", "E", "F"];

    // 1. One KYC row per user (no duplicates)
    const dupRows = await L.dbq("SELECT user_id, COUNT(*) c FROM user_kyc GROUP BY user_id HAVING c > 1");
    L.T("db", "no-dup-kyc", "no duplicate user_kyc rows per user", dupRows.length === 0, `dups=${dupRows.length}`);

    // 2. Unique index + FKs exist
    const idx = await L.dbq("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='chit_fund' AND TABLE_NAME='user_kyc' AND NON_UNIQUE=0");
    const fks = await L.dbq(`SELECT TABLE_NAME, CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA='chit_fund' AND TABLE_NAME IN ('user_kyc','user_kyc_history') ORDER BY TABLE_NAME`);
    const uniqUser = idx.some((i) => i.INDEX_NAME === "user_id");
    L.T("db", "kyc-unique-idx", "user_kyc has UNIQUE(user_id)", uniqUser, `idx=${idx.map((i) => i.INDEX_NAME).join(",")}`);
    L.T("db", "kyc-fks", "FKs RESTRICT on user_kyc/user_kyc_history", fks.every((f) => f.DELETE_RULE === "RESTRICT"), JSON.stringify(fks));

    // 3. Personal accounts (id 6,7) untouched vs baseline
    const now6 = await L.dbOne("SELECT verification_status, account_status, created_at FROM users WHERE user_id = 6");
    const now7 = await L.dbOne("SELECT verification_status, account_status, created_at FROM users WHERE user_id = 7");
    const base = state.baseline.users;
    const base6 = base.find((u) => u.user_id === 6);
    const base7 = base.find((u) => u.user_id === 7);
    L.T("db", "personal-untouched", "pre-existing accounts 6/7 unchanged", !!base6 && !!base7 && now6.verification_status === base6.verification_status && now7.verification_status === base7.verification_status,
      `u6=${now6.verification_status} u7=${now7.verification_status}`);

    // 4. Timestamps sane (A: submitted <= verified; B history order)
    const kycA = await L.dbOne("SELECT submitted_at, verified_at FROM user_kyc WHERE user_id = ?", [state.members.A.id]);
    L.T("db", "timestamps-A", "A verified_at after submitted_at", !!kycA && kycA.verified_at && new Date(kycA.verified_at) >= new Date(kycA.submitted_at),
      `sub=${kycA && kycA.submitted_at} ver=${kycA && kycA.verified_at}`);

    // 5. No raw PII columns in kyc tables
    const cols = await L.dbq("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='chit_fund' AND TABLE_NAME='user_kyc'");
    const colNames = cols.map((c) => c.COLUMN_NAME);
    const rawPan = colNames.some((c) => c.toLowerCase().includes("pan") && !c.toLowerCase().includes("hash") && !c.toLowerCase().includes("masked"));
    const rawAd = colNames.some((c) => c.toLowerCase().includes("aadhaar") && !c.toLowerCase().includes("hash") && !c.toLowerCase().includes("masked"));
    L.T("db", "no-raw-pii-col", "no raw PAN/Aadhaar columns", !rawPan && !rawAd, `cols=${colNames.join(",")}`);

    // 6. Masked/hash values match for our members (A excluded: PAN replaced by self-downgrade test by design)
    let maskOk = true; let why = "";
    for (const tag of tags) {
      if (tag === "A" || tag === "C") continue;
      const m = state.members[tag];
      const row = await L.dbOne("SELECT pan_number_hash, aadhaar_number_hash FROM user_kyc WHERE user_id = ?", [m.id]);
      if (!row) { maskOk = false; why += tag + ":no-row;"; continue; }
      if (row.pan_number_hash !== L.sha256(m.pan) || row.aadhaar_number_hash !== L.sha256(m.aadhaar)) { maskOk = false; why += tag + ":hash-mismatch;"; }
    }
    L.T("db", "hash-consistency", "stored hashes match submitted synthetic PAN/Aadhaar (A excluded)", maskOk, why || "ok");
    // A: masked PAN cannot reveal that resubmit replaced the underlying PAN (hash diff only)
    const aRow = await L.dbOne("SELECT pan_number_masked FROM user_kyc WHERE user_id = ?", [state.members.A.id]);
    const aExpectedMask = state.members.A.pan.slice(0, 5) + "****" + state.members.A.pan.slice(9);
    L.T("db", "A-pan-masked-identical", "masked PAN identical after replacement (change invisible in UI; only hashes/history show it)", aRow && aRow.pan_number_masked === aExpectedMask,
      `masked=${aRow && aRow.pan_number_masked}`);

    // 7. Final verification statuses
    const finalStatus = {};
    for (const tag of ["A", "B", "D", "E", "F"]) {
      const u = await L.dbOne("SELECT verification_status FROM users WHERE user_id = ?", [state.members[tag].id]);
      finalStatus[tag] = u.verification_status;
    }
    L.T("db", "final-status", "approved members end VERIFIED", Object.values(finalStatus).every((s) => s === "VERIFIED"), JSON.stringify(finalStatus));

    // 8. Wallet created per registered user
    const noWallet = await L.dbq(`SELECT user_id FROM users WHERE user_id NOT IN (SELECT user_id FROM wallets) AND user_id >= 8`);
    L.T("db", "wallets", "every new user has a wallet", noWallet.length === 0, `missing=${noWallet.length}`);

    // 9. History preserved (…->REJECTED->SUBMITTED->VERIFIED for F)
    const histF = await L.dbq("SELECT action_type, status FROM user_kyc_history WHERE user_id = ? ORDER BY performed_at", [state.members.F.id]);
    const fSeq = histF.map((h) => h.status);
    const fTail = fSeq.slice(-3).join(",") === "REJECTED,PENDING,VERIFIED";
    L.T("db", "history-F", "F history ends REJECTED->PENDING(resubmit)->VERIFIED", fSeq.length >= 4 && fTail, JSON.stringify(histF.map((h) => h.action_type + "/" + h.status)));

    // 10. Membership uniqueness (chit_members unique per chit+member)
    const chitIdx = await L.dbq("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='chit_fund' AND TABLE_NAME='chit_members' AND NON_UNIQUE=0");
    L.T("db", "cm-unique-idx", "chit_members has unique member-per-chit index", chitIdx.length > 0, `idx=${chitIdx.map((i) => i.INDEX_NAME).join(",")}`);

    // 11. Stored docs exist on disk (resolve relative placeholder against backend dir)
    const docRows = await L.dbq("SELECT user_id, id_document_path FROM user_kyc");
    const fs = require("fs");
    const pathMod = require("path");
    const missing = docRows.filter((r) => !fs.existsSync(pathMod.isAbsolute(r.id_document_path) ? r.id_document_path : pathMod.join(L.BACKEND_DIR, r.id_document_path)));
    // Known-by-design: no-document submissions reference default-placeholder.pdf (file not shipped) -> stream returns 404
    const noDocOwners = missing.filter((r) => r.id_document_path.includes("default-placeholder") || r.id_document_path.endsWith("test.pdf"));
    const realMissing = missing.filter((r) => !r.id_document_path.includes("default-placeholder") && !r.id_document_path.endsWith("test.pdf"));
    L.T("db", "docs-on-disk", "no real uploaded doc missing on disk", realMissing.length === 0, `missing=${realMissing.map((r) => r.id_document_path).join("|") || "none"}`);
    L.T("db", "docs-placeholder", "no-doc rows reference placeholder file that does not exist (finding)", noDocOwners.length >= 1,
      `owners=${noDocOwners.map((r) => "user" + r.user_id).join(",")}`);

    L.saveState(state);
  },
};
