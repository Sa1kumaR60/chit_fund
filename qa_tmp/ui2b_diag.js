// Diagnostic: why does the DigiLocker CTA not navigate? (poll for button, log net + URL)
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const ROOT = path.join(__dirname, "..");
const FRONTEND = path.join(ROOT, "new_react");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ready(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => http.get(url, (res) => { res.resume(); resolve(true); }).on("error", () => (Date.now() - start > timeoutMs ? resolve(false) : setTimeout(tick, 700)));
    tick();
  });
}
const API = "http://127.0.0.1:5000/api";
const post = (p, body, token) => fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body || {}) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

(async () => {
  const fd = fs.openSync(path.join(__dirname, "logs", "ui2b-backend.log"), "a");
  const server = spawn(process.execPath, [path.join(__dirname, "test_server.js")], { cwd: ROOT, stdio: ["ignore", fd, fd] });
  const vfd = fs.openSync(path.join(__dirname, "logs", "ui2b-vite.log"), "a");
  const vite = spawn(process.execPath, [path.join(FRONTEND, "node_modules", "vite", "bin", "vite.js"), "--host", "0.0.0.0", "--port", "5173", "--strictPort"], { cwd: FRONTEND, stdio: ["ignore", vfd, vfd] });
  await ready("http://127.0.0.1:5000/", 30000);
  const uiOk = await ready("http://localhost:5173/", 90000);
  console.log("vite ready (localhost):", uiOk);

  // fresh member
  const phone = "7" + String(Math.floor(100000000 + Math.random() * 899999999));
  const email = "qadiag." + Date.now().toString(36) + "@test.local";
  await post("/auth/register", { name: "Diag QA User", phone, email, password: "Test@1234", role: "MEMBER" });
  const lg = await post("/auth/login", { phone, password: "Test@1234" });

  const puppeteer = require(path.join(__dirname, "node_modules", "puppeteer-core"));
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--window-size=1440,900"] });
  const page = await browser.newPage();
  const events = [];
  page.on("dialog", async (d) => { events.push("DIALOG: " + d.message()); await d.accept().catch(() => {}); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) events.push("NAV: " + f.url().slice(0, 120)); });
  page.on("response", (r) => { if (r.url().includes("/api/profile/kyc")) events.push("RES " + r.status() + " " + r.url().replace("http://127.0.0.1:5000", "")); });
  page.on("requestfailed", (r) => events.push("REQFAIL " + r.url().slice(0, 100)));
  page.on("console", (m) => { if (/error/i.test(m.type())) events.push("CONSOLE " + m.text().slice(0, 120)); });

  await page.goto("http://localhost:5173/", { waitUntil: "networkidle2", timeout: 60000 });
  await page.type('input[name="phone"]', phone);
  await page.type('input[name="password"]', "Test@1234");
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Login/i.test(x.textContent)); if (b) b.click(); });
  await sleep(2500);
  events.push("after login url=" + page.url());
  await page.goto("http://localhost:5173/profile", { waitUntil: "networkidle2", timeout: 30000 });
  // poll for tab + CTA
  let ctaFound = false;
  for (let i = 0; i < 20; i++) {
    const found = await page.evaluate(() => {
      const tab = [...document.querySelectorAll("button")].find((b) => /KYC & Verification/.test(b.textContent));
      if (tab) tab.click();
      return !![...document.querySelectorAll("button")].find((b) => /Start DigiLocker Identity Verification/.test(b.textContent));
    });
    if (found) { ctaFound = true; events.push("CTA found after " + (i * 500) + "ms"); break; }
    await sleep(500);
  }
  const allButtons = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim().slice(0, 48)));
  events.push("buttons=" + JSON.stringify(allButtons));
  if (ctaFound) {
    const clicked = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Start DigiLocker Identity Verification/.test(x.textContent)); if (b) { b.click(); return true; } return false; });
    events.push("CTA clicked=" + clicked);
    for (let i = 0; i < 24; i++) { await sleep(500); if (!page.url().includes("/profile")) break; }
    events.push("final url=" + page.url());
    events.push("body=" + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, " | ").slice(0, 200));
    await page.screenshot({ path: path.join(__dirname, "screenshots2", "diag-callback.png") });
  }
  console.log(JSON.stringify({ ctaFound, events }, null, 1));
  await browser.close();
  server.kill(); vite.kill();
  process.exit(0);
})();
