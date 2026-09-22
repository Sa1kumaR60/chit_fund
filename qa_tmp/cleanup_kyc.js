// Cleanup synthetic KYC rows for a member tag (test artifact cleanup)
const mysql = require("C:/Users/saiku/OneDrive/Desktop/chit_fund/backend/node_modules/mysql2");
const st = require("./state.json");
const tag = process.argv[2] || "B";
const m = st.members[tag];
if (!m) { console.error("no member " + tag); process.exit(1); }
const c = mysql.createConnection({ host: "127.0.0.1", user: "root", password: "Sa1kumaR11.1", database: "chit_fund" });
c.connect((e) => {
  if (e) { console.error("FAIL", e.message); process.exit(1); }
  const q = (s, p) => new Promise((ok, no) => c.query(s, p, (er, r) => (er ? no(er) : ok(r))));
  (async () => {
    await q("DELETE FROM user_kyc_history WHERE user_id = ?", [m.id]);
    await q("DELETE FROM user_kyc WHERE user_id = ?", [m.id]);
    const [[chk]] = await q("SELECT COUNT(*) c FROM user_kyc WHERE user_id = ?", [m.id]);
    console.log("cleaned " + tag + " (id=" + m.id + ") kyc rows now=" + chk.c);
    c.end();
  })().catch((er) => { console.error("ERR", er.message); c.end(); });
});
