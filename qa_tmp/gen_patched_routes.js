// Generates qa_tmp/patched_profileRoutes.js = copy of backend/routes/profileRoutes.js
// with ONLY the missing kycAdminController import added (plus absolute require paths
// so the copy can live outside backend/). No project source file is modified.
const fs = require("fs");
const path = require("path");
const BACKEND = path.join(__dirname, "..", "backend");
const B = BACKEND.replace(/\\/g, "/");
const src = fs.readFileSync(path.join(BACKEND, "routes", "profileRoutes.js"), "utf8");

const anchor = 'const kycController = require("../controllers/kycController");';
if (!src.includes(anchor)) { console.error("anchor not found; aborting"); process.exit(1); }

let patched = src;
// insert the missing import FIRST (while relative requires are still intact)
patched = patched.replace(
  anchor,
  anchor + `\nconst kycAdminController = require("${B}/controllers/kycAdminController");`
);
// then absolutize requires so the copy can live outside backend/
patched = patched
  .replace(/require\("express"\)/g, `require("${B}/node_modules/express")`)
  .replace(/require\("\.\.\/middleware\//g, `require("${B}/middleware/`)
  .replace(/require\("\.\.\/controllers\//g, `require("${B}/controllers/`)
  .replace(/require\("\.\.\/utils\//g, `require("${B}/utils/`)
  .replace(/require\("\.\.\/services\//g, `require("${B}/services/`)
  .replace(/require\("\.\.\/db"\)/g, `require("${B}/db")`);

const outPath = path.join(__dirname, "patched_profileRoutes.js");
fs.writeFileSync(outPath, patched);

// verify: strip absolute paths & whitespace, then the ONLY difference must be the new import
const norm = (s) => s.replace(/C:\/Users\/saiku\/OneDrive\/Desktop\/chit_fund\/backend\//g, "").replace(/\s+/g, " ").trim();
const a = norm(src), b = norm(patched);
console.log("generated:", outPath);
console.log("normalized identical except added import:", b === a.replace(anchor, anchor + " const kycAdminController = require(\"controllers/kycAdminController\");"));
console.log("added-import present:", patched.includes('const kycAdminController = require('));
