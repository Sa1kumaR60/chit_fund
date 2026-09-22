// Spawns hb.js detached and exits (cron survival test)
const { spawn } = require("child_process");
const fs = require("fs");
const hbScript = "C:/Users/saiku/OneDrive/Desktop/chit_fund/qa_tmp/logs/hb.js";
const hbLog = "C:/Users/saiku/OneDrive/Desktop/chit_fund/qa_tmp/logs/hb2.txt";
fs.writeFileSync(hbLog, "");
const child = spawn(process.execPath, [hbScript], { detached: true, stdio: "ignore" });
child.unref();
fs.appendFileSync(hbLog, "spawned:" + child.pid + ";");
console.log("spawned:" + child.pid);
