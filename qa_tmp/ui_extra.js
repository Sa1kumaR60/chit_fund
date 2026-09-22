// Extra checks: rapid concurrent KYC submits + browser back/forward during KYC flow
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const FRONTEND = path.join(ROOT, "new_react");
const state = require("./state.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ready(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => http.get(url, (res) => { res.resume(); resolve(true); }).on("error", () => (Date.now() - start > timeoutMs ? resolve(false) : setTimeout(tick, 700)));
    tick();
  });
}
const results = [];
const T = (id, label, ok, detail) => { results.push({ id, ok: !!ok }); console.log(`[${ok ? "PASS" : "FAIL"}] extra :: ${id} :: ${label} :: ${detail || ""}`); };

(async () => {
  const logOut = fs.openSync(path.join(__dirname, "logs", "extra-backend.log"), "a");
  const backend = spawn(process.execPath, ["index.js"], { cwd: BACKEND, stdio: ["ignore", logOut, logOut] });
  const viteOut = fs.openSync(path.join(__dirname, "logs", "extra-vite.log"), "a");
  const vite = spawn(process.execPath, [path.join(FRONTEND, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", "5175", "--strictPort"], { cwd: FRONTEND, stdio: ["ignore", viteOut, viteOut] });
  await ready("http://127.0.0.1:5000/", 30000);
  await ready("http://127.0.0.1:5175/", 90000);
  const API = "http://127.0.0.1:5000/api";

  // ---- 1. rapid concurrent submits ----
  const phone = "7" + String(Date.now()).slice(-9);
  const pan = "RAPID" + String(Math.floor(1000 + Math.random() * 9000)) + "K";
  const aad = "6" + String(Math.floor(Math.random() * 9e10) + 1e10);
  await fetch(API + "/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "QA Rapid", phone, email: "qarapid." + Date.now().toString(36) + "@test.local", password: "Test@1234", role: "MEMBER" }) });
  const lg = await (await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, password: "Test@1234" }) })).json();
  const one = () => fetch(API + "/profile/kyc", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + lg.token }, body: JSON.stringify({ pan_number: pan, aadhaar_number: aad }) }).then((r) => r.status);
  const statuses = await Promise.all([one(), one(), one()]);
  const mysql = require(path.join(BACKEND, "node_modules", "mysql2"));
  const pool = mysql.createPool({ host: "127.0.0.1", user: "root", password: "Sa1kumaR11.1", database: "chit_fund" });
  const [[rowCount]] = await pool.promise().query("SELECT COUNT(*) c FROM user_kyc WHERE user_id = ?", [lg.user_id]);
  const [[histCount]] = await pool.promise().query("SELECT COUNT(*) c FROM user_kyc_history WHERE user_id = ?", [lg.user_id]);
  T("rapid-submit", "3 concurrent submits: statuses", statuses.every((s) => s === 200 || s === 500), `statuses=${statuses.join(",")}`);
  T("rapid-row", "exactly one KYC row after concurrent submits", rowCount.c === 1, `rows=${rowCount.c} history=${histCount.c}`);

  // ---- 2. browser back/forward ----
  const puppeteer = require(path.join(__dirname, "node_modules", "puppeteer-core"));
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--window-size=1440,900"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const A = state.members.A;
  const freshA = await (await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: A.phone, password: A.password }) })).json();
  await page.evaluateOnNewDocument((t) => { localStorage.setItem("token", t.token); localStorage.setItem("role", t.role); localStorage.setItem("user", JSON.stringify({ id: t.user_id, role: t.role, phone: t.phone })); }, { token: freshA.token, role: "MEMBER", user_id: freshA.user_id, phone: A.phone });
  await page.goto("http://127.0.0.1:5175/profile", { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(1200);
  const clickText = async (sel, text) => page.evaluate((s, t) => { const el = [...document.querySelectorAll(s)].find((e) => (e.textContent || "").includes(t)); if (el) { el.click(); return true; } return false; }, sel, text);
  await clickText("button", "KYC & Verification");
  await sleep(600);
  const urlProfile = page.url();
  await clickText("button", "← Dashboard");
  await sleep(1200);
  const urlDash = page.url();
  await page.goBack({ waitUntil: "networkidle2" });
  await sleep(1000);
  const urlBack = page.url();
  await page.goForward({ waitUntil: "networkidle2" });
  await sleep(1000);
  const urlFwd = page.url();
  const tokenKept = await page.evaluate(() => !!localStorage.getItem("token"));
  T("back-forward", "browser back/forward within KYC flow keeps session & routes", tokenKept && urlBack.includes("/profile") && urlFwd.includes("/member") && urlDash.includes("/member") && urlProfile.includes("/profile"),
    `profile=${urlProfile} dash=${urlDash} back=${urlBack} fwd=${urlFwd} token=${tokenKept}`);

  await browser.close();
  backend.kill(); vite.kill();
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n==== EXTRA SUMMARY: ${pass} passed, ${results.length - pass} failed ====`);
  process.exit(0);
})();
