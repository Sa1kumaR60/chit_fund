// Faithful test server: identical mounts to backend/index.js, but /api/profile uses
// the patched router copy (original crashes at require due to a missing import).
// No project source file is modified.
const path = require("path");
const express = require(path.join(__dirname, "..", "backend", "node_modules", "express"));
const cors = require(path.join(__dirname, "..", "backend", "node_modules", "cors"));
require(path.join(__dirname, "..", "backend", "node_modules", "dotenv")).config({ path: path.join(__dirname, "..", "backend", ".env") });

const B = path.join(__dirname, "..", "backend");
const app = express();
app.use(cors({ origin: (o, cb) => cb(null, true), credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.use("/api/auth", require(path.join(B, "routes", "authRoutes")));
app.use("/api/chits", require(path.join(B, "routes", "chitRoutes")));
app.use("/api/payments", require(path.join(B, "routes", "paymentRoutes")));
app.use("/api/auctions", require(path.join(B, "routes", "auctionRoutes")));
app.use("/api/dashboard", require(path.join(B, "routes", "dashboardRoutes")));
app.use("/api/wallets", require(path.join(B, "routes", "walletRoutes")));
app.use("/api/notifications", require(path.join(B, "routes", "notificationRoutes")));
app.use("/api/profile", require(path.join(__dirname, "patched_profileRoutes.js")));

app.get("/", (req, res) => res.send("Chit Fund Backend Running (QA patched-routes harness)"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`[QA HARNESS] server running on port ${PORT}`));
