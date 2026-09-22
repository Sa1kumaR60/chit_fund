// Phase: register synthetic members + admin login + baseline
const PASS = "Test@1234";
const ADMIN_PHONE = "9999999999";
const ADMIN_PASS = "password123";

async function register(L, tag, role) {
  const phone = L.synthPhone();
  const email = L.synthEmail(tag);
  const name = "QA KYC " + tag;
  const body = { name, phone, email, password: PASS, role: role || "MEMBER" };
  const res = await L.call("POST", "/auth/register", { body });
  return { ...body, res };
}

module.exports = {
  async run(L) {
    const state = L.loadState();
    state.members = state.members || {};
    state.admin = state.admin || {};
    state.chits = state.chits || {};

    // Admin login
    let ar = await L.call("POST", "/auth/login", { body: { phone: ADMIN_PHONE, password: ADMIN_PASS } });
    L.T("provision", "admin-login", "QA admin login", ar.status === 200, `status=${ar.status} role=${ar.json && ar.json.role} id=${ar.json && ar.json.user_id}`);
    state.admin.token = ar.json.token;
    state.admin.id = ar.json.user_id;

    // Baseline DB
    state.baseline = state.baseline || {};
    if (!state.baseline.users) {
      const rows = await L.dbq("SELECT user_id,name,role,verification_status FROM users");
      state.baseline.users = rows;
      state.baseline.kycCount = (await L.dbq("SELECT COUNT(*) c FROM user_kyc"))[0].c;
      state.baseline.chits = (await L.dbq("SELECT chit_id,group_name,status FROM chits"));
    }
    L.T("provision", "baseline", "baseline captured", true, `users=${state.baseline.users.length} kyc=${state.baseline.kycCount} chits=${state.baseline.chits.length}`);

    // Rogue admin registration check (public admin registration policy)
    const rogue = await register(L, "rogue", "ADMIN");
    const rogueRes = rogue.res;
    L.T("provision", "public-admin-reg", "anonymous ADMIN registration allowed?", rogueRes.status === 200 && rogueRes.json && rogueRes.json.role === "ADMIN",
      `status=${rogueRes.status} role=${rogueRes.json && rogueRes.json.role} msg=${rogueRes.json && rogueRes.json.message}`);
    state.rogueAdmin = { phone: rogue.phone, pass: PASS, email: rogue.email };

    // Duplicate register
    const dup = await L.call("POST", "/auth/register", { body: { name: "x", phone: rogue.phone, email: L.synthEmail("dup"), password: PASS, role: "MEMBER" } });
    L.T("provision", "dup-phone-reg", "duplicate phone rejected", dup.status === 400, `status=${dup.status} msg=${dup.json && dup.json.message}`);

    // Members A..F
    for (const tag of ["A", "B", "C", "D", "E", "F"]) {
      const reg = await register(L, tag, "MEMBER");
      L.T("provision", "reg-" + tag, "register member " + tag, reg.res.status === 200, `status=${reg.res.status}`);
      const lg = await L.call("POST", "/auth/login", { body: { phone: reg.phone, password: PASS } });
      L.T("provision", "login-" + tag, "login member " + tag, lg.status === 200 && lg.json.role === "MEMBER", `status=${lg.status}`);
      const pan = L.synthPan("QPLXY");
      const aadhaar = L.synthAadhaar();
      const acc = { tag, name: reg.name, phone: reg.phone, email: reg.email, password: PASS, id: lg.json.user_id, token: lg.json.token, pan, aadhaar };
      state.members[tag] = acc;
      const prof = await L.call("GET", "/profile", { token: acc.token });
      L.T("provision", "status-" + tag, "default verification_status", prof.json && prof.json.user && prof.json.user.verification_status === "PENDING",
        `status=${prof.json && prof.json.user && prof.json.user.verification_status}`);
    }

    // Wrong password / unknown user login
    const badPw = await L.call("POST", "/auth/login", { body: { phone: ADMIN_PHONE, password: "WrongPass1" } });
    L.T("provision", "bad-pw", "wrong password rejected", badPw.status === 401, `status=${badPw.status}`);
    const noUser = await L.call("POST", "/auth/login", { body: { phone: "7000000000", password: PASS } });
    L.T("provision", "unknown-user", "unknown user rejected", noUser.status === 401, `status=${noUser.status}`);

    L.saveState(state);
  },
};
