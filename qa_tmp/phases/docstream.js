// Phase: document streaming authorization (owner/admin/IDOR) + GET /profile/kyc exposure
module.exports = {
  async run(L) {
    const state = L.loadState();
    const A = state.members.A, D = state.members.D, E = state.members.E;
    const ids = {};
    for (const tag of ["A", "D", "E"]) {
      const row = await L.dbOne("SELECT kyc_id FROM user_kyc WHERE user_id = ?", [state.members[tag].id]);
      ids[tag] = row ? row.kyc_id : null;
      L.T("docstream", "id-" + tag, "kyc id for " + tag, !!ids[tag], "kyc_id=" + ids[tag]);
    }
    state.kycIds = state.kycIds || {};
    Object.assign(state.kycIds, ids);

    // Owner stream
    const ownDoc = await L.call("GET", "/profile/kyc/document/" + ids.E, { token: E.token });
    L.T("docstream", "doc-owner", "owner streams own doc", ownDoc.status === 200, `status=${ownDoc.status} ct=${ownDoc.headers["content-type"]}`);
    // IDOR: A tries E doc
    const idor = await L.call("GET", "/profile/kyc/document/" + ids.E, { token: A.token });
    L.T("docstream", "doc-idor", "other member cannot stream doc (IDOR blocked)", idor.status === 403, `status=${idor.status} msg=${idor.json && idor.json.message}`);
    // no token
    const noTok = await L.call("GET", "/profile/kyc/document/" + ids.E, {});
    L.T("docstream", "doc-notoken", "no token cannot stream doc", noTok.status === 401, `status=${noTok.status}`);
    // admin stream
    const adminDoc = await L.call("GET", "/profile/kyc/document/" + ids.E, { token: state.admin.token });
    L.T("docstream", "doc-admin", "admin can stream any doc", adminDoc.status === 200, `status=${adminDoc.status}`);
    // ghost
    const ghost = await L.call("GET", "/profile/kyc/document/999999", { token: A.token });
    L.T("docstream", "doc-ghost", "nonexistent kyc doc -> 404", ghost.status === 404, `status=${ghost.status}`);
    // bad id type
    const badId = await L.call("GET", "/profile/kyc/document/abc", { token: A.token });
    L.T("docstream", "doc-badid", "non-numeric kycId handled", [400, 404].includes(badId.status), `status=${badId.status}`);

    // API response exposure for owner
    const gk = await L.call("GET", "/profile/kyc", { token: A.token });
    const k = (gk.json && gk.json.kyc) || {};
    const keys = Object.keys(k);
    L.T("docstream", "A-getkyc-keys", "GET /profile/kyc returns masked, no hashes/path", gk.status === 200 && !("pan_number_hash" in k) && !("aadhaar_number_hash" in k) && !("id_document_path" in k) && ("pan_number_masked" in k), `keys=${keys.join(",")}`);
    L.T("docstream", "A-getkyc-status", "GET /profile/kyc status PENDING", k.status === "PENDING", `status=${k.status}`);

    L.saveState(state);
  },
};
