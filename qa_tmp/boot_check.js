// Boot check: start backend, capture startup output, hit endpoints, report
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const ROOT = path.join(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ready(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => http.get(url, (res) => { res.resume(); resolve(true); }).on("error", () => (Date.now() - start > timeoutMs ? resolve(false) : setTimeout(tick, 500)));
    tick();
  });
}
(async () => {
  const logPath = path.join(__dirname, "logs", "boot-check.log");
  fs.writeFileSync(logPath, "");
  const log = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, ["index.js"], { cwd: BACKEND, stdio: ["ignore", log, log] });
  const up = await ready("http://127.0.0.1:5000/", 15000);
  console.log("SERVER UP:", up);
  if (up) {
    const r = await fetch("http://127.0.0.1:5000/api/profile/kyc/status", { headers: {} });
    console.log("GET /api/profile/kyc/status (no token):", r.status);
  }
  child.kill();
  await sleep(400);
  console.log("--- startup log ---");
  console.log(fs.readFileSync(logPath, "utf8").split("\n").slice(0, 40).join("\n"));
  process.exit(0);
})();
