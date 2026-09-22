const mysql = require("C:/Users/saiku/OneDrive/Desktop/chit_fund/backend/node_modules/mysql2");
const c = mysql.createConnection({ host: "127.0.0.1", user: "root", password: "Sa1kumaR11.1", database: "chit_fund" });
c.connect((e) => {
  if (e) { console.error("FAIL", e.message); process.exit(1); }
  const q = (s) => new Promise((ok, no) => c.query(s, (er, r) => (er ? no(er) : ok(r))));
  (async () => {
    const cols = await q("SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='chit_fund' AND TABLE_NAME='user_kyc' ORDER BY ORDINAL_POSITION");
    console.log("=== user_kyc columns ===");
    cols.forEach((x) => console.log(`  ${x.COLUMN_NAME} :: ${x.COLUMN_TYPE} :: null=${x.IS_NULLABLE}`));
    const hcols = await q("SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='chit_fund' AND TABLE_NAME='user_kyc_history' AND COLUMN_NAME IN ('action_type','status')");
    console.log("=== history enums ===");
    hcols.forEach((x) => console.log(`  ${x.COLUMN_NAME} :: ${x.COLUMN_TYPE}`));
    const tbl = await q("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='chit_fund' AND TABLE_NAME IN ('kyc_verification_sessions','user_kyc','user_kyc_history')");
    console.log("=== tables present ===", tbl.map((t) => t.TABLE_NAME).join(", "));
    let sess;
    try { sess = await q("SELECT COUNT(*) c FROM kyc_verification_sessions"); } catch (er) { sess = [{ c: "TABLE MISSING: " + er.code }]; }
    console.log("sessions rows:", JSON.stringify(sess));
    const byStatus = await q("SELECT status, COUNT(*) c FROM user_kyc GROUP BY status");
    console.log("=== user_kyc rows by status ==="); byStatus.forEach((r) => console.log(`  ${r.status} = ${r.c}`));
    const modes = await q("SELECT @@sql_mode m, @@version v");
    console.log("sql_mode:", modes[0].m); console.log("version:", modes[0].v);
    c.end();
  })().catch((er) => { console.error("ERR", er.message); c.end(); });
});
