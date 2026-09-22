// QA launcher: starts backend/index.js detached, logs to qa_tmp/logs
const { spawn } = require("child_process");
const path = require("path");

const backendDir = path.join(__dirname, "..", "backend");
const outLog = path.join(__dirname, "logs", "backend.out.log");
const errLog = path.join(__dirname, "logs", "backend.err.log");
const fs = require("fs");
fs.writeFileSync(outLog, "");
fs.writeFileSync(errLog, "");

const child = spawn(process.execPath, ["index.js"], {
  cwd: backendDir,
  detached: true,
  stdio: ["ignore", fs.openSync(outLog, "a"), fs.openSync(errLog, "a")],
});
child.unref();
console.log("spawned pid=" + child.pid);
setTimeout(() => process.exit(0), 1500);
