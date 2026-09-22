// CLI: node qa_tmp/run_phase.js <phaseName>
// Starts a fresh backend, runs the phase, stops the backend, prints summary.
const L = require("./lib");

(async () => {
  const phaseName = process.argv[2];
  if (!phaseName) {
    console.error("usage: node run_phase.js <phase>");
    process.exit(2);
  }
  let child = null;
  try {
    child = await L.startServer();
    console.log("== server ready ==");
  } catch (e) {
    console.error("server start failed:", e.message);
    process.exit(3);
  }
  try {
    const phase = require("./phases/" + phaseName);
    if (typeof phase.run !== "function") throw new Error("phase has no run()");
    await phase.run(L);
  } catch (e) {
    console.error("PHASE ERROR:", e.stack || e.message);
    process.exitCode = 4;
  }
  await L.stopServer(child);
  L.summary();
  process.exit(process.exitCode || (L.results.some((r) => !r.ok) ? 1 : 0));
})();
