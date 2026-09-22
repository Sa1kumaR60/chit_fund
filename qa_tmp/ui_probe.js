// Focused probe: what happens in the UI on an oversized KYC upload?
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const FRONTEND = path.join(ROOT, "new_react");
const TMP = path.join(__dirname, "tmpfiles");
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, "big.pdf"), Buffer.alloc(1200 * 1024, 0x41));
fs.writeFileSync(path.join(TMP, "doc.pdf"), Buffer.from("%PDF-1.4 QA"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ready(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => http.get(url, (res) => { res.resume(); resolve(true); }).on("error", () => (Date.now() - start > timeoutMs ? resolve(false) : setTimeout(tick, 700)));
    tick();
  });
}

(async () => {
  const logOut = fs.openSync(path.join(__dirname, "logs", "probe-backend.log"), "a");
  const backend = spawn(process.execPath, ["index.js"], { cwd: BACKEND, stdio: ["ignore", logOut, logOut] });
  const viteOut = fs.openSync(path.join(__dirname, "logs", "probe-vite.log"), "a");
  const vite = spawn(process.execPath, [path.join(FRONTEND, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", "5174", "--strictPort"], { cwd: FRONTEND, stdio: ["ignore", viteOut, viteOut] });
  await ready("http://127.0.0.1:5000/", 30000);
  await ready("http://127.0.0.1:5174/", 90000);
  const BASE = "http://127.0.0.1:5174";

  // fresh member via API
  const phone = "7" + String(Date.now()).slice(-9);
  const reg = await fetch("http://127.0.0.1:5000/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "QA Probe", phone, email: "qaprobe." + Date.now().toString(36) + "@test.local", password: "Test@1234", role: "MEMBER" }) });
  const lg = await (await fetch("http://127.0.0.1:5000/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, password: "Test@1234" }) })).json();

  const puppeteer = require(path.join(__dirname, "node_modules", "puppeteer-core"));
  const exe = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox", "--window-size=1440,900"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const events = [];
  page.on("request", (r) => { if (r.url().includes("/profile/kyc")) events.push("REQ " + r.method() + " " + r.url() + " bodyLen~" + (r.postData() || "").length); });
  page.on("response", (r) => { if (r.url().includes("/profile/kyc")) events.push("RES " + r.status() + " " + r.url()); });
  page.on("requestfailed", (r) => { if (r.url().includes("/profile/kyc")) events.push("FAILED " + (r.failure() && r.failure().errorText) + " " + r.url()); });
  page.on("console", (m) => { if (/error|warn/i.test(m.type())) events.push("CONSOLE " + m.type() + " " + m.text().slice(0, 120)); });

  await page.evaluateOnNewDocument((t) => { localStorage.setItem("token", t.token); localStorage.setItem("role", t.role); localStorage.setItem("user", JSON.stringify({ id: t.user_id, role: t.role, phone: t.phone })); }, { token: lg.token, role: lg.role, user_id: lg.user_id, phone });
  await page.goto(BASE + "/profile", { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(1500);
  const clickText = async (selector, text) => page.evaluate((sel, t) => { const el = [...document.querySelectorAll(sel)].find((e) => (e.textContent || "").includes(t)); if (el) { el.click(); return true; } return false; }, selector, text);
  await clickText("button", "KYC & Verification");
  await sleep(600);
  const rnd = () => String(Math.floor(Math.random() * 9e9) + 1e9);
  const aad = "5" + rnd();
  await page.type('input[placeholder="ABCDE1234F"]', "PRBXY" + String(Math.floor(1000 + Math.random() * 9000)) + "Q");
  await page.type('input[placeholder="123456789012"]', aad);
  const fi = await page.$('input[type="file"]');
  await fi.uploadFile(path.join(TMP, "big.pdf"));
  await sleep(2500); // allow FileReader to finish -> emulates user pausing before submit
  events.push("uploaded big.pdf (" + fs.statSync(path.join(TMP, "big.pdf")).size + " bytes), waited 2.5s");
  const clicked = await clickText("button", "Submit KYC for Verification");
  events.push("submit clicked=" + clicked);
  await sleep(4000);
  const alerts = await page.evaluate(() => [...document.querySelectorAll(".alert")].map((a) => a.className + " :: " + a.textContent.trim().slice(0, 120)));
  const bodySnip = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | ").slice(0, 400));
  console.log(JSON.stringify({ events, alerts, bodySnip }, null, 1));
  await browser.close();
  backend.kill(); vite.kill();
  process.exit(0);
})();
