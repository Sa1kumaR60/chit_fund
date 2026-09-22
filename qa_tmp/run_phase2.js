// CLI: node qa_tmp/run_phase2.js <phase2Name>
// Starts the QA harness server (identical routes; supplies the import the shipped
// entrypoint is missing), runs the phase, stops the server.
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const L = require("./lib");

function waitReady(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      fetch(url).then((r) => resolve(true)).catch(() => (Date.now() - start > timeoutMs ? resolve(false) : setTimeout(tick, 500)));
    };
    tick();
  });
}

(async () => {
  const phaseName = process.argv[2];
  if (!phaseName) { console.error("usage: node run_phase2.js <phase>"); process.exit(2); }
  const logFd = fs.openSync(path.join(L.LOG_DIR, "newflow-server.log"), "a");
  fs.writeSync(logFd, `\n===== RUN ${phaseName} ${new Date().toISOString()} =====\n`);
  const child = spawn(process.execPath, [path.join(__dirname, "test_server.js")], { cwd: L.ROOT, stdio: ["ignore", logFd, logFd] });
  const ok = await waitReady("http://127.0.0.1:5000/", 30000);
  console.log(ok ? "== harness server ready ==" : "== SERVER FAILED TO START ==");
  if (!ok) { child.kill(); process.exit(3); }
  try {
    await require(path.join(__dirname, "phases2", phaseName + ".js")).run(L);
    L.summary();
  } catch (e) {
    console.error("PHASE ERROR:", e && e.stack ? e.stack : e);
  }
  try { child.kill(); } catch (_) {}
  process.exit(0);
})();
