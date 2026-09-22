// Print current KYC schema state + data snapshot
const path = require("path");
const mysql = require(path.join("C:/Users/saiku/OneDrive/Desktop/chit_fund/backend/node_modules", "mysql2"));
const c = mysql.createConnection({ host: "127.0.0.1", user: "root", password: "Sa1kumaR11.1", database: "chit_fund" });
c.connect((e) => {
  if (e) { console.error("FAIL", e.message); process.exit(1); }
  const q = (s, p) => new Promise((ok, no) => c.query(s, p, (er, r) => (er ? no(er) : ok(r))));
  (async () => {
    const [t0] = await q("SHOW TABLES LIKE 'kyc_verification_sessions'");
    console.log("kyc_verification_sessions exists:", t0.length > 0);
    const [cols] = await q("SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='chit_fund' AND TABLE_NAME='user_kyc'");
    console.log("user_kyc columns:");
    cols.forEach((r) => console.log("   ", r.COLUMN_NAME, "|", r.COLUMN_TYPE));
    const [rows] = await q("SELECT user_id, status, verification_provider, reason_code FROM user_kyc ORDER BY user_id");
    console.log("existing user_kyc rows:", JSON.stringify(rows));
    const [[sess]] = await q("SELECT COUNT(*) c FROM kyc_verification_sessions");
    console.log("kyc_verification_sessions rows:", sess.c);
    const [[u]] = await q("SELECT COUNT(*) c FROM users");
    console.log("users:", u.c);
    c.end();
  })().catch((er) => { console.error("ERR", er.message); c.end(); });
});
