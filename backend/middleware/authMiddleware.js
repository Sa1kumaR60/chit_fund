const jwt = require("jsonwebtoken");
const db = require("../db");
const dbPromise = db.promise();

const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if token_version is still valid in database
    const [[user]] = await dbPromise.query(
      "SELECT user_id, role, token_version FROM users WHERE user_id = ?",
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({ message: "User account no longer exists" });
    }

    if (
      decoded.token_version !== undefined &&
      Number(decoded.token_version) !== Number(user.token_version)
    ) {
      return res.status(401).json({
        message: "Password was recently changed or session revoked. Please log in again.",
        sessionRevoked: true,
      });
    }

    req.user = {
      id: user.user_id,
      role: user.role,
      token_version: user.token_version,
    };
    
    return next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid token" });
  }
};

const requireRole = (role) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.user.role !== role) {
    return res.status(403).json({ message: `Access denied. ${role} role required.` });
  }

  return next();
};

module.exports = {
  authMiddleware,
  requireRole,
};
