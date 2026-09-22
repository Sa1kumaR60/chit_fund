// Single-call UI E2E test: starts backend + Vite, drives Chrome via puppeteer-core
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const FRONTEND = path.join(ROOT, "new_react");
const OUT = path.join(__dirname, "screenshots");
const TMP = path.join(__dirname, "tmpfiles");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
const state = require("./state.json");

const results = [];
function T(id, label, ok, detail) {
  results.push({ id, label, ok: !!ok, detail: detail || "" });
  console.log(`[${ok ? "PASS" : "FAIL"}] ui :: ${id} :: ${label}${detail ? " :: " + detail : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ready(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      http.get(url, (res) => { res.resume(); resolve(true); }).on("error", () => {
        if (Date.now() - start > timeoutMs) resolve(false); else setTimeout(tick, 700);
      });
    };
    tick();
  });
}

(async () => {
  // temp upload files
  fs.writeFileSync(path.join(TMP, "doc.pdf"), Buffer.from("%PDF-1.4\nQA synthetic identity doc\n%%EOF"));
  fs.writeFileSync(path.join(TMP, "bad.exe"), Buffer.from("MZ\x90\x00QA-EXECUTABLE"));
  fs.writeFileSync(path.join(TMP, "page.html"), "<html><script>alert(1)</script></html>");
  fs.writeFileSync(path.join(TMP, "big.pdf"), Buffer.alloc(1200 * 1024, 0x41));

  const logOut = fs.openSync(path.join(__dirname, "logs", "ui-backend.log"), "a");
  const backend = spawn(process.execPath, ["index.js"], { cwd: BACKEND, stdio: ["ignore", logOut, logOut] });
  const viteOut = fs.openSync(path.join(__dirname, "logs", "ui-vite.log"), "a");
  const vite = spawn(process.execPath, [path.join(FRONTEND, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", "5173", "--strictPort"], { cwd: FRONTEND, stdio: ["ignore", viteOut, viteOut] });

  const apiOk = await ready("http://127.0.0.1:5000/", 30000);
  T("backend", "backend on :5000", apiOk, "");
  const uiOk = await ready("http://127.0.0.1:5173/", 90000);
  T("vite", "vite dev server on :5173", uiOk, "");

  const puppeteer = require(path.join(__dirname, "node_modules", "puppeteer-core"));
  const chromePaths = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    process.env.LOCALAPPDATA + "/Google/Chrome/Application/chrome.exe",
  ];
  const exe = chromePaths.find((p) => p && fs.existsSync(p));
  T("chrome", "system Chrome found", !!exe, exe || "not found");
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,900"] });
  } catch (e) {
    try { browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox"] }); }
    catch (e2) { console.error("BROWSER LAUNCH FAILED", e2.message); }
  }

  const BASE = "http://127.0.0.1:5173";
  const consoleMsgs = [];
  const kycPosts = [];
  const newMember = { name: "QA UI Member", phone: "7" + String(Date.now()).slice(-9), email: "qaui." + Date.now().toString(36) + "@test.local", password: "Test@1234" };
  const uiPan = "UIQAA1234Z", uiAadhaar = "432112345678";

  if (browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on("console", (m) => consoleMsgs.push(m.type() + ": " + m.text()));
    page.on("dialog", async (d) => { await d.accept().catch(() => {}); });
    page.on("request", (r) => { if (r.url().includes("/api/profile/kyc") && r.method() === "POST") kycPosts.push(Date.now()); });
    const clickText = async (selector, text) => page.evaluate((sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((e) => (e.textContent || "").includes(t));
      if (el) { el.click(); return true; } return false;
    }, selector, text);
    const bodyText = () => page.evaluate(() => document.body.innerText);

    try {
      // ---------- Login page ----------
      await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 60000 });
      const hasPhone = await page.$('input[name="phone"]');
      T("login-render", "login page renders form", !!hasPhone, (await bodyText()).slice(0, 60).replace(/\n/g, " | "));
      const adminOption = await page.evaluate(() => { const s = document.querySelector('a[href="/register"]'); return document.body.innerText.includes("Admin (First setup only)"); });
      // wrong credentials
      await page.type('input[name="phone"]', state.admin.phone);
      await page.type('input[name="password"]', "WrongPass9");
      await clickText("button", "Login");
      await sleep(1200);
      let bt = await bodyText();
      T("login-wrong", "wrong credentials show error", /Invalid password|User not found/i.test(bt), bt.split("\n").find((l) => /Invalid|not found/i.test(l)) || "");

      // ---------- Register via UI ----------
      await page.goto(BASE + "/register", { waitUntil: "networkidle2", timeout: 60000 });
      const roleOptions = await page.evaluate(() => [...document.querySelectorAll("select#role option")].map((o) => o.value + ":" + o.textContent));
      T("register-role-ui", "Register UI exposes ADMIN role option (public admin reg)", roleOptions.some((o) => o.startsWith("ADMIN")), roleOptions.join(" | "));
      await page.type("#name", newMember.name);
      await page.type("#phone", newMember.phone);
      await page.type("#email", newMember.email);
      await page.type("#password", newMember.password);
      await clickText("button", "Create Account");
      await sleep(1800);
      let url = page.url();
      T("register-flow", "UI registration succeeds -> login page", url === BASE + "/", `url=${url}`);

      // ---------- Member login ----------
      await page.type('input[name="phone"]', newMember.phone);
      await page.type('input[name="password"]', newMember.password);
      await clickText("button", "Login");
      await sleep(2500);
      bt = await bodyText();
      T("member-login", "member logs in -> Member Dashboard", page.url().includes("/member") && /Member Dashboard/i.test(bt), `url=${page.url()}`);
      await page.screenshot({ path: path.join(OUT, "01-member-dashboard.png") });

      // ---------- Profile + KYC tab ----------
      await page.goto(BASE + "/profile", { waitUntil: "networkidle2", timeout: 30000 });
      await sleep(1500);
      bt = await bodyText();
      T("profile-open", "member opens profile", page.url().includes("/profile") && /KYC/.test(bt), `url=${page.url()}`);
      T("profile-badge", "profile banner shows KYC PENDING badge", /KYC PENDING/.test(bt), bt.split("\n").find((l) => /KYC \w+/.test(l)) || "");
      await clickText("button", "KYC & Verification");
      await sleep(800);
      const inputs = await page.evaluate(() => ({
        pan: !!document.querySelector('input[placeholder="ABCDE1234F"]'),
        aad: !!document.querySelector('input[placeholder="123456789012"]'),
        file: !!document.querySelector('input[type="file"]'),
        panReq: document.querySelector('input[placeholder="ABCDE1234F"]')?.required,
        aadReq: document.querySelector('input[placeholder="123456789012"]')?.required,
        fileReq: document.querySelector('input[type="file"]')?.required,
        fileAccept: document.querySelector('input[type="file"]')?.accept,
      }));
      T("kyc-form", "KYC form loads with PAN/Aadhaar/file inputs", inputs.pan && inputs.aad && inputs.file, JSON.stringify(inputs));
      T("kyc-required", "required fields marked", !!inputs.panReq && !!inputs.aadReq && !!inputs.fileReq, `fileAccept=${inputs.fileAccept}`);
      await page.screenshot({ path: path.join(OUT, "02-member-kyc-form.png") });

      // ---------- Empty submit blocked by browser validation ----------
      const postsBefore = kycPosts.length;
      await clickText("button", "Submit KYC for Verification");
      await sleep(1200);
      T("kyc-empty-submit", "empty submit blocked client-side (no API call)", kycPosts.length === postsBefore, `posts ${postsBefore}->${kycPosts.length}`);

      // ---------- Invalid PAN ----------
      await page.type('input[placeholder="ABCDE1234F"]', "12345");
      await page.type('input[placeholder="123456789012"]', uiAadhaar);
      let fileInput = await page.$('input[type="file"]');
      await fileInput.uploadFile(path.join(TMP, "doc.pdf"));
      await clickText("button", "Submit KYC for Verification");
      await sleep(1800);
      bt = await bodyText();
      T("kyc-invalid-pan", "invalid PAN shows server error message", /Invalid PAN number format/i.test(bt), bt.split("\n").find((l) => /Invalid PAN/i.test(l)) || bt.slice(0, 140).replace(/\n/g, " | "));

      // ---------- Invalid file type (.exe) ----------
      await page.evaluate(() => { const i = document.querySelector('input[placeholder="ABCDE1234F"]'); if (i) { i.value = ""; } });
      await page.click('input[placeholder="ABCDE1234F"]', { clickCount: 3 });
      await page.type('input[placeholder="ABCDE1234F"]', uiPan);
      fileInput = await page.$('input[type="file"]');
      await fileInput.uploadFile(path.join(TMP, "bad.exe"));
      await clickText("button", "Submit KYC for Verification");
      await sleep(2000);
      bt = await bodyText();
      T("kyc-bad-file", "invalid file type (.exe) produces error message", /Invalid document format|Failed to submit|error/i.test(bt), bt.split("\n").find((l) => /Invalid document|Failed to submit/i.test(l)) || "no error text");

      // ---------- Oversize file ----------
      fileInput = await page.$('input[type="file"]');
      await fileInput.uploadFile(path.join(TMP, "big.pdf"));
      await clickText("button", "Submit KYC for Verification");
      await sleep(2500);
      bt = await bodyText();
      T("kyc-oversize", "oversized file (>1MB) produces error message", /Failed to submit|error|large|Invalid/i.test(bt), bt.split("\n").find((l) => /Failed to submit|large/i.test(l)) || "no error text");

      // ---------- Valid submit ----------
      fileInput = await page.$('input[type="file"]');
      await fileInput.uploadFile(path.join(TMP, "doc.pdf"));
      await clickText("button", "Submit KYC for Verification");
      await sleep(2200);
      bt = await bodyText();
      T("kyc-valid-submit", "valid KYC submitted via UI", /submitted successfully for Admin review|PENDING/i.test(bt), bt.split("\n").find((l) => /submitted successfully/i.test(l)) || "");
      T("kyc-status-pending", "UI shows PENDING status", /PENDING/.test(bt), "");
      T("kyc-history-ui", "timeline history visible", /Timeline|SUBMITTED/i.test(bt), "");
      await page.screenshot({ path: path.join(OUT, "03-member-kyc-pending.png") });

      // ---------- Persistence across reload ----------
      await page.reload({ waitUntil: "networkidle2" });
      await sleep(1500);
      bt = await bodyText();
      T("kyc-reload", "status persists after page reload", /PENDING/.test(bt), "");

      // ---------- Direct access without token ----------
      await page.evaluate(() => localStorage.clear());
      await page.goto(BASE + "/profile", { waitUntil: "networkidle2", timeout: 30000 });
      await sleep(1200);
      T("guard-direct", "logged-out /profile access redirects to login", !page.url().includes("/profile"), `url=${page.url()}`);

      // ---------- Admin review ----------
      await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 30000 });
      await page.type('input[name="phone"]', state.admin.phone);
      await page.type('input[name="password"]', state.admin.password);
      await clickText("button", "Login");
      await sleep(2500);
      T("admin-login", "QA admin logs in -> /admin", page.url().includes("/admin"), `url=${page.url()}`);
      await page.goto(BASE + "/profile", { waitUntil: "networkidle2", timeout: 30000 });
      await sleep(2000);
      bt = await bodyText();
      const queueBtn = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /KYC Review Queue/.test(b.textContent)));
      T("admin-queue-tab", "admin sees KYC Review Queue tab", queueBtn, "");
      await clickText("button", "KYC Review Queue");
      await sleep(1200);
      bt = await bodyText();
      const seesMember = bt.includes(newMember.name) || bt.includes(newMember.phone);
      T("admin-sees-submission", "admin sees the member's pending submission", seesMember, `memberVisible=${seesMember}`);
      await page.screenshot({ path: path.join(OUT, "04-admin-queue.png") });
      const clickReview = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /Review Submission/.test(x.textContent));
        if (b) { b.click(); return true; } return false;
      });
      await sleep(800);
      bt = await bodyText();
      const seesMasked = /PAN:/.test(bt) && /\*/.test(bt);
      T("admin-review-modal", "review panel shows masked PAN/Aadhaar (no document viewer)", clickReview && seesMasked, `maskedShown=${seesMasked}`);
      const approveClicked = await clickText("button", "Approve & Verify KYC");
      await sleep(2500);
      bt = await bodyText();
      T("admin-approve", "admin approves KYC from UI", approveClicked, bt.split("\n").find((l) => /verified successfully/i.test(l)) || "clicked");
      await page.screenshot({ path: path.join(OUT, "05-admin-after-approve.png") });

      // ---------- Member sees VERIFIED ----------
      await page.evaluate(() => localStorage.clear());
      await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 30000 });
      await page.type('input[name="phone"]', newMember.phone);
      await page.type('input[name="password"]', newMember.password);
      await clickText("button", "Login");
      await sleep(2500);
      await page.goto(BASE + "/profile", { waitUntil: "networkidle2", timeout: 30000 });
      await sleep(1800);
      bt = await bodyText();
      T("member-sees-verified", "member UI shows KYC VERIFIED after approval", /KYC VERIFIED/.test(bt), bt.split("\n").find((l) => /KYC VERIFIED/.test(l)) || "");
      const historyVerified = /VERIFIED/.test(bt);
      T("member-history-verified", "timeline shows VERIFIED entry", historyVerified, "");
      await page.screenshot({ path: path.join(OUT, "06-member-verified.png") });

      // ---------- Route guard (last: it clears the session) ----------
      const tokenBefore = await page.evaluate(() => localStorage.getItem("token"));
      await page.goto(BASE + "/admin", { waitUntil: "networkidle2", timeout: 30000 });
      await sleep(1500);
      const tokenAfter = await page.evaluate(() => localStorage.getItem("token"));
      const urlAfter = page.url();
      T("guard-admin", "member blocked from /admin", !urlAfter.includes("/admin"), `url=${urlAfter}`);
      T("guard-admin-session", "EXPECTED: redirect to /member keeping session | ACTUAL: redirect to / and session cleared (bug)",
        urlAfter.includes("/member") && !!tokenAfter,
        `url=${urlAfter} tokenBefore=${!!tokenBefore} tokenAfter=${!!tokenAfter}`);
      // re-login works after the forced logout
      await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 30000 });
      await page.type('input[name="phone"]', newMember.phone);
      await page.type('input[name="password"]', newMember.password);
      await clickText("button", "Login");
      await sleep(2200);
      T("relogin-after-guard", "member can log in again after forced logout", page.url().includes("/member"), `url=${page.url()}`);
    } catch (e) {
      T("ui-error", "unexpected UI error", false, e.message);
    } finally {
      // console PII scan
      const allConsole = consoleMsgs.join("\n");
      const piiHit = allConsole.includes(uiPan) || allConsole.includes(uiAadhaar) || allConsole.includes(state.members.A.pan) || allConsole.includes(state.members.A.aadhaar);
      T("console-pii", "no synthetic PAN/Aadhaar in browser console", !piiHit, `console lines=${consoleMsgs.length} hits=${piiHit}`);
      const errs = consoleMsgs.filter((m) => /error:/i.test(m));
      T("console-errors", "no unexpected console errors (recorded)", errs.length === 0, errs.slice(0, 3).join(" || ").slice(0, 200));
      fs.writeFileSync(path.join(__dirname, "ui_results.json"), JSON.stringify({ results, consoleMsgs, kycPosts, newMember: { phone: newMember.phone, name: newMember.name } }, null, 2));
      await browser.close().catch(() => {});
    }
  }

  try { backend.kill(); } catch (_) {}
  try { vite.kill(); } catch (_) {}
  await sleep(500);
  const pass = results.filter((r) => r.ok).length, fail = results.filter((r) => !r.ok).length;
  console.log(`\n==== UI SUMMARY: ${pass} passed, ${fail} failed ====`);
  process.exit(0);
})();
