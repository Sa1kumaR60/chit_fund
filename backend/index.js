const express = require("express");
const cors = require("cors");
require("dotenv").config();

const db = require("./db");

const authRoutes = require("./routes/authRoutes");
const chitRoutes = require("./routes/chitRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const auctionRoutes = require("./routes/auctionRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const walletRoutes = require("./routes/walletRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const profileRoutes = require("./routes/profileRoutes");
const { initCronJobs } = require("./services/cronService");

const path = require("path");

const app = express();

app.use(cors({
  origin: function(origin, callback) {
    // Allow any origin for local development testing
    callback(null, true);
  },
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));

// Static uploads route for avatar media
app.use("/uploads", express.static(path.join(__dirname, "uploads"), { dotfiles: "ignore", index: false }));

app.use("/api/auth", authRoutes);
app.use("/api/chits", chitRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/auctions", auctionRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/wallets", walletRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/profile", profileRoutes);

app.get("/", (req, res) => {
  res.send("Chit Fund Backend Running");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Initialize scheduled tasks
  initCronJobs();
});
