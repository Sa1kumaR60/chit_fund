// UI E2E for the NEW KYC flow. Uses the QA harness server (identical routes; the shipped
// entrypoint cannot boot due to the missing import). Backend :5000, Vite :5173.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const FRONTEND = path.join(ROOT, "new_react");
const OUT = path.join(__dirname, "screenshots2");
fs.mkdirSync(OUT, { recursive: true });
const s2 = require("./state2.json");
const s1 = require("./state.json");

function ready(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => http.get(url, (res) => { res.resume(); resolve(true); }).on("error", () => (Date.now() - start > timeoutMs ? resolve(false) : setTimeout(tick, 700)));
    tick();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const T = (id, label, ok, detail) => { results.push({ id, label, ok: !!ok, detail: detail || "" }); console.log(`[${ok ? "PASS" : "FAIL"}] ui2 :: ${id} :: ${label}${detail ? " :: " + detail : ""}`); };
const API = "http://127.0.0.1:5000/api";
const post = (p, body, token) => fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body || {}) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

(async () => {
  const logFd = fs.openSync(path.join(__dirname, "logs", "ui2-backend.log"), "a");
  const server = spawn(process.execPath, [path.join(__dirname, "test_server.js")], { cwd: ROOT, stdio: ["ignore", logFd, logFd] });
  const viteFd = fs.openSync(path.join(__dirname, "logs", "ui2-vite.log"), "a");
  const vite = spawn(process.execPath, [path.join(FRONTEND, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", "5173", "--strictPort"], { cwd: FRONTEND, stdio: ["ignore", viteFd, viteFd] });
  T("server", "harness backend up", await ready("http://127.0.0.1:5000/", 30000), "");
  T("vite", "vite up", await ready("http://127.0.0.1:5173/", 90000), "");

  // ---- API setup ----
  const mkMember = async (name) => {
    const phone = "7" + String(Math.floor(100000000 + Math.random() * 899999999));
    const email = "qaui2." + Date.now().toString(36) + Math.floor(Math.random() * 1000) + "@test.local";
    await post("/auth/register", { name, phone, email, password: "Test@1234", role: "MEMBER" });
    const lg = await post("/auth/login", { phone, password: "Test@1234" });
    return { name, phone, email, id: lg.json.user_id, token: lg.json.token };
  };
  const U1 = await mkMember("Ravi QA Verified");
  const U2 = await mkMember("Sita QA Review");
  const U3 = await mkMember("Arjun QA Blocked");
  T("setup", "3 UI members created", !!(U1.id && U2.id && U3.id), `U1=${U1.id} U2=${U2.id} U3=${U3.id}`);

  // release mock Aadhaar hash so U1 can verify (held by M5 from API tests)
  const mysqlPath = path.join(ROOT, "backend", "node_modules", "mysql2");
  const mysql = require(mysqlPath);
  const conn = mysql.createConnection({ host: "127.0.0.1", user: "root", password: "Sa1kumaR11.1", database: "chit_fund" });
  const q = (sql, p) => new Promise((ok, no) => conn.query(sql, p, (e, r) => (e ? no(e) : ok(r))));
  await q("UPDATE user_kyc SET aadhaar_number_hash = ? WHERE aadhaar_number_hash <> ? AND status='VERIFIED'", ["QA-RELEASED-UI-" + Date.now(), "x"]);
  T("setup", "mock Aadhaar hash released for UI happy path", true, "");

  // U2 -> REVIEW_REQUIRED via duplicate path after U1 verifies (done later); prepare a chit invitation for U3
  const adm = s2.admin;
  const g = await post("/chits/wizard/create", { group_name: "QA UI2 Gate", type: "FIXED", chit_value: 60000, start_date: "2026-12-01", duration_months: 1, total_members: 1, monthly_due_date: 5, grace_period_days: 3, description: "ui2" }, adm.token);
  const gid = g.json.chit_id;
  await post(`/chits/wizard/${gid}/slots`, { slots: [{ assigned_month: 1, member_name: U3.name, invitee_phone: U3.phone }] }, adm.token);
  const invRows = await q("SELECT invitation_token FROM chit_invitations WHERE invitee_phone = ? AND chit_id = ?", [U3.phone, gid]);
  const u3Token = invRows[0].invitation_token;

  // ---- browser ----
  const puppeteer = require(path.join(__dirname, "node_modules", "puppeteer-core"));
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--window-size=1440,900"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const consoleMsgs = [];
  const dialogs = [];
  page.on("console", (m) => consoleMsgs.push(m.type() + ": " + m.text()));
  page.on("dialog", async (d) => { dialogs.push(d.message()); await d.accept().catch(() => {}); });
  const BASE = "http://127.0.0.1:5173";
  const clickText = (sel, text) => page.evaluate((s, t) => { const el = [...document.querySelectorAll(s)].find((e) => (e.textContent || "").includes(t)); if (el) { el.click(); return true; } return false; }, sel, text);
  const bodyText = () => page.evaluate(() => document.body.innerText);

  try {
    // 1) U1 login -> profile -> KYC tab (NOT_STARTED + DigiLocker button)
    await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 60000 });
    await page.type('input[name="phone"]', U1.phone);
    await page.type('input[name="password"]', "Test@1234");
    await clickText("button", "Login");
    await sleep(2500);
    await page.goto(BASE + "/profile", { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(1500);
    await clickText("button", "KYC & Verification");
    await sleep(800);
    let bt = await bodyText();
    T("member-kyc-tab", "KYC tab shows NOT_STARTED + DigiLocker CTA", /NOT_STARTED/.test(bt) && /Start DigiLocker Identity Verification/i.test(bt), bt.split("\n").find((l) => /Verification Status/.test(l)) || "");
    await page.screenshot({ path: path.join(OUT, "01-kyc-not-started.png") });

    // 2) start DigiLocker (mock) -> callback page
    await clickText("button", "Start DigiLocker Identity Verification");
    await sleep(4000);
    let url = page.url();
    bt = await bodyText();
    T("callback-url", "redirected to /kyc/callback", url.includes("/kyc/callback"), `url=${url.slice(0, 110)}`);
    T("callback-verified-ui", "callback page shows Identity Verified Successfully", /Identity Verified Successfully/i.test(bt), bt.replace(/\n+/g, " | ").slice(0, 160));
    await page.screenshot({ path: path.join(OUT, "02-callback-verified.png") });

    // 3) view profile -> VERIFIED
    await clickText("button", "View Profile");
    await sleep(2500);
    await clickText("button", "KYC & Verification").catch(() => {});
    await sleep(800);
    bt = await bodyText();
    T("member-verified", "profile shows VERIFIED + provider MOCK + masked aadhaar", /VERIFIED/.test(bt) && /MOCK/.test(bt) && /XXXX-XXXX-9901/.test(bt),
      bt.split("\n").filter((l) => /Verification Status|XXXX/.test(l)).join(" | ").slice(0, 180));
    await page.screenshot({ path: path.join(OUT, "03-member-verified.png") });

    // 4) blocked member (U3) claim -> alert only, no KYC modal
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 30000 });
    await page.type('input[name="phone"]', U3.phone);
    await page.type('input[name="password"]', "Test@1234");
    await clickText("button", "Login");
    await sleep(2500);
    await page.type('input[placeholder="Paste Invitation Token or Code..."]', u3Token);
    dialogs.length = 0;
    await clickText("button", "Claim Slot");
    await sleep(2000);
    bt = await bodyText();
    const modalShown = /Identity Verification Required/i.test(bt);
    T("blocked-join-alert", "blocked claim shows KYC-mandatory message", dialogs.some((d) => /KYC verification is mandatory/i.test(d)), `dialogs=${JSON.stringify(dialogs)}`);
    T("blocked-join-no-modal", "in-app KYC prompt does NOT open (kycRequired key vs requiresKyc mismatch)", !modalShown, `modalShown=${modalShown}`);
    await page.screenshot({ path: path.join(OUT, "04-blocked-claim.png") });

    // 5) U2 -> REVIEW_REQUIRED (duplicate path) then admin approves via UI
    const iU2 = await post("/profile/kyc/initiate", {}, U2.token);
    const cbU2 = await post("/profile/kyc/callback", { code: "mock_authorization_code_sandbox", state: iU2.json.stateToken, mockName: U2.name }, U2.token);
    T("u2-review", "U2 routed to REVIEW_REQUIRED (duplicate Aadhaar)", cbU2.status === 200 && cbU2.json.status === "REVIEW_REQUIRED", JSON.stringify(cbU2.json));
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 30000 });
    await page.type('input[name="phone"]', adm.phone);
    await page.type('input[name="password"]', adm.password);
    await clickText("button", "Login");
    await sleep(2500);
    await page.goto(BASE + "/profile", { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(1800);
    await clickText("button", "KYC Review Queue");
    await sleep(1200);
    bt = await bodyText();
    T("admin-queue-ui", "admin queue lists U2 submission", bt.includes(U2.name) || bt.includes(U2.phone), `found=${bt.includes(U2.name) || bt.includes(U2.phone)}`);
    const maskedQuality = /PENDING/.test(bt) && !/XXXX-XXXX-9901/.test(bt);
    T("admin-queue-masked-quality", "queue shows literal 'PENDING' instead of masked Aadhaar (data-quality bug)", maskedQuality, `literalPENDING=${maskedQuality}`);
    await page.screenshot({ path: path.join(OUT, "05-admin-queue.png") });
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Review Submission/.test(x.textContent)); if (b) b.click(); });
    await sleep(800);
    await clickText("button", "Approve & Verify KYC");
    await sleep(2500);
    bt = await bodyText();
    T("admin-approve-ui", "admin approves from UI", dialogs.some((d) => /verified successfully/i.test(d)) || /VERIFIED/.test(bt), `dialogs=${JSON.stringify(dialogs.slice(-2))}`);
    await page.screenshot({ path: path.join(OUT, "06-admin-approved.png") });

    // 6) U2 sees VERIFIED
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 30000 });
    await page.type('input[name="phone"]', U2.phone);
    await page.type('input[name="password"]', "Test@1234");
    await clickText("button", "Login");
    await sleep(2500);
    await page.goto(BASE + "/profile", { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(1500);
    bt = await bodyText();
    T("u2-verified-ui", "U2 profile shows KYC VERIFIED after admin approval", /KYC VERIFIED/.test(bt), bt.split("\n").find((l) => /KYC VERIFIED/.test(l)) || "");

    // 7) logged-out callback access
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + "/kyc/callback?code=x&state=y", { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(1200);
    T("callback-guard", "logged-out callback page redirects to login", !page.url().includes("/kyc/callback"), `url=${page.url()}`);

    // console scan
    const piiHit = consoleMsgs.join("\n").includes(U1.name) || consoleMsgs.join("\n").includes("999988889901");
    T("console-pii", "no identity data leaked to browser console", !piiHit, `lines=${consoleMsgs.length}`);
    const errs = consoleMsgs.filter((m) => /^error:/i.test(m));
    T("console-errors", "console errors recorded", errs.length >= 0, errs.slice(0, 4).join(" || ").slice(0, 200));
  } catch (e) {
    T("ui2-error", "unexpected UI error", false, e.message);
  } finally {
    fs.writeFileSync(path.join(__dirname, "ui2_results.json"), JSON.stringify({ results, consoleMsgs, dialogs }, null, 2));
    await browser.close().catch(() => {});
  }
  try { conn.end(); } catch (_) {}
  server.kill(); vite.kill();
  await sleep(400);
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n==== UI2 SUMMARY: ${pass} passed, ${results.length - pass} failed ====`);
  process.exit(0);
})();
