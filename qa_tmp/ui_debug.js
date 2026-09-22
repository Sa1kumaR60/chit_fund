// Debug: why does UI registration not submit?
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const REACT_DIR = path.join(ROOT, "new_react");
const puppeteer = require(path.join(__dirname, "node_modules", "puppeteer-core"));
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function spawnLog(cmd, args, cwd, log) { const o = fs.openSync(log, "a"); return spawn(cmd, args, { cwd, stdio: ["ignore", o, o] }); }
async function waitHttp(u, t) { const s = Date.now(); while (Date.now() - s < t) { try { const r = await fetch(u, { signal: AbortSignal.timeout(1500) }); if (r.status) return; } catch (_) {} await sleep(700); } throw new Error("timeout " + u); }

(async () => {
  const backend = spawnLog(process.execPath, ["index.js"], BACKEND_DIR, path.join(__dirname, "logs", "server-ui.log"));
  await waitHttp("http://127.0.0.1:5000/api/auth/login", 30000);
  const vite = spawnLog(process.execPath, [path.join(REACT_DIR, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", "5173", "--strictPort"], REACT_DIR, path.join(__dirname, "logs", "vite.log"));
  await waitHttp(APP, 90000);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    const events = [];
    page.on("dialog", (d) => { events.push("DIALOG: " + d.message()); d.accept().catch(() => {}); });
    page.on("console", (m) => events.push("CONSOLE " + m.type() + ": " + m.text()));
    page.on("pageerror", (e) => events.push("PAGEERROR: " + e.message));
    page.on("request", (r) => { if (r.method() !== "GET") events.push("REQ " + r.method() + " " + r.url()); });
    page.on("response", async (r) => { if (r.request().method() !== "GET") { let body = ""; try { body = (await r.text()).slice(0, 200); } catch (_) {} events.push("RESP " + r.status() + " " + r.url() + " :: " + body); } });

    const phone = "70" + String(Math.floor(10000000 + Math.random() * 89999999));
    await page.goto(APP + "/register", { waitUntil: "networkidle2" });
    await sleep(1500);
    await page.type('input[name="name"]', "QA UI Debug");
    await page.type('input[name="phone"]', phone);
    await page.type('input[name="email"]', "qaout.debug." + Date.now().toString(36) + "@test.local");
    await page.type('input[name="password"]', "Test@1234");
    await page.evaluate(() => { const f = document.querySelector("form"); const btn = f ? f.querySelector('button[type="submit"]') : null; if (btn) btn.click(); else events.push("NO_SUBMIT_BUTTON"); });
    await sleep(4000);
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 600));
    console.log("URL:", page.url());
    console.log("BODY:", JSON.stringify(txt));
    console.log("EVENTS:\n" + events.join("\n"));
  } finally {
    await browser.close(); vite.kill(); backend.kill();
    await sleep(500);
  }
})();
