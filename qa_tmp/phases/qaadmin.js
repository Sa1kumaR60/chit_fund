// Phase: create + login a synthetic QA ADMIN (public admin registration is enabled)
const PASS = "Test@1234";
module.exports = {
  async run(L) {
    const state = L.loadState();
    state.members = state.members || {};
    // if a members.A exists from provision, provision already saved; just add admin
    const phone = L.synthPhone();
    const email = L.synthEmail("qaadmin");
    const reg = await L.call("POST", "/auth/register", {
      body: { name: "QA KYC Admin", phone, email, password: PASS, role: "ADMIN" },
    });
    L.T("qaadmin", "reg", "register synthetic QA admin", reg.status === 200, `status=${reg.status} role=${reg.json && reg.json.role}`);
    const lg = await L.call("POST", "/auth/login", { body: { phone, password: PASS } });
    L.T("qaadmin", "login", "login QA admin", lg.status === 200, `status=${lg.status}`);
    state.admin = { phone, password: PASS, email, token: lg.json.token, id: lg.json.user_id };
    state.rogueAdmin = state.rogueAdmin || {};
    L.saveState(state);
    console.log("QA ADMIN id=" + state.admin.id);
  },
};
