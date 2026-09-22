// QA harness shared library: server lifecycle, HTTP calls, DB helpers, state
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const ENV_FILE = path.join(BACKEND_DIR, ".env");
const LOG_DIR = path.join(__dirname, "logs");
const STATE_FILE = process.env.QA_STATE_FILE ? path.join(__dirname, process.env.QA_STATE_FILE) : path.join(__dirname, "state.json");

// ---- env ----
function loadEnv() {
  const out = {};
  fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  });
  return out;
}
const ENV = loadEnv();
Object.assign(process.env, ENV);
// Explicit process env wins over the .env file (dotenv-compatible, lets QA point at a scratch DB)
["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"].forEach((k) => {
  if (process.env[k]) ENV[k] = process.env[k];
});

// ---- server lifecycle ----
function startServer(timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const log = fs.openSync(path.join(LOG_DIR, "server-batch.log"), "a");
    // Server is launched through a QA shim (qa_tmp/server_shim.js) which provides the
    // global that routes/profileRoutes.js references but does not import. No project
    // source files are modified.
    const child = spawn(process.execPath, [path.join(__dirname, "server_shim.js")], {
      cwd: BACKEND_DIR,
      stdio: ["ignore", log, log],
      detached: false,
      env: process.env,
    });
    const started = Date.now();
    const poll = setInterval(async () => {
      try {
        const res = await fetch("http://127.0.0.1:5000/", { signal: AbortSignal.timeout(1500) });
        if (res.status !== undefined) {
          clearInterval(poll);
          resolve(child);
        }
      } catch (_) {
        if (Date.now() - started > timeoutMs) {
          clearInterval(poll);
          child.kill();
          reject(new Error("server did not become ready"));
        }
      }
    }, 500);
    child.on("exit", (code) => {
      clearInterval(poll);
      reject(new Error("server exited early code=" + code));
    });
  });
}
async function stopServer(child) {
  try { child.kill(); } catch (_) {}
  await new Promise((r) => setTimeout(r, 600));
}

// ---- http ----
const BASE = "http://127.0.0.1:5000/api";
async function call(method, urlPath, opts = {}) {
  const { token, body, headers, raw } = opts;
  const h = { Accept: "application/json", ...headers };
  if (body !== undefined && !raw) h["Content-Type"] = "application/json";
  if (token) h.Authorization = "Bearer " + token;
  const res = await fetch(BASE + urlPath, {
    method,
    headers: h,
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  const hdrs = {};
  res.headers.forEach((v, k) => { hdrs[k] = v; });
  return { status: res.status, json, text, ok: res.ok, headers: hdrs };
}

// ---- db ----
const mysql = require(path.join(BACKEND_DIR, "node_modules", "mysql2"));
const pool = mysql.createPool({
  host: ENV.DB_HOST || "127.0.0.1",
  user: ENV.DB_USER,
  password: ENV.DB_PASSWORD,
  database: ENV.DB_NAME,
  connectionLimit: 4,
});
const dbq = (sql, params) => pool.promise().query(sql, params).then(([rows]) => rows);
async function dbOne(sql, params) { const r = await dbq(sql, params); return r[0] || null; }

// ---- state ----
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch (_) { return {}; }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---- synthetic data ----
const used = new Set();
function synthPhone() {
  let p;
  do { p = "70" + String(Math.floor(10000000 + Math.random() * 89999999)); } while (used.has(p));
  used.add(p);
  return p;
}
function synthEmail(tag) {
  return "qakyc." + tag + "." + Date.now().toString(36) + "@test.local";
}
function synthPan(tag) {
  // format: 5 letters + 4 digits + 1 letter
  const letters = (tag || "QAT").toUpperCase().padEnd(3, "X").slice(0, 3);
  return letters + "PL" + String(Math.floor(1000 + Math.random() * 9000)) + "Z";
}
function synthAadhaar() {
  let d;
  do { d = "4" + String(Math.floor(10000000000 + Math.random() * 89999999999)); } while (used.has("a" + d));
  used.add("a" + d);
  return d;
}
function sha256(t) {
  return crypto.createHash("sha256").update(String(t).trim().toUpperCase()).digest("hex");
}

// ---- results ----
const results = [];
function T(phase, id, label, ok, detail) {
  results.push({ phase, id, label, ok: !!ok, detail: detail || "" });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${phase} :: ${id} :: ${label}${detail ? " :: " + detail : ""}`);
}
function summary() {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n==== PHASE SUMMARY: ${pass} passed, ${fail} failed ====`);
}

module.exports = {
  ROOT, BACKEND_DIR, ENV, LOG_DIR,
  startServer, stopServer, call, BASE,
  dbq, dbOne, loadState, saveState,
  synthPhone, synthEmail, synthPan, synthAadhaar, sha256,
  T, summary, results,
};
