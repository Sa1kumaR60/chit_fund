/**
 * Configurable In-Memory Rate Limiter Middleware for Password Reset & Auth Endpoints
 */

const ipRequestMap = new Map();
const identifierRequestMap = new Map();

// Environment configuration defaults
const WINDOW_MS = (parseInt(process.env.RESET_RATE_WINDOW_MINUTES, 10) || 15) * 60 * 1000; // 15 mins
const MAX_IP_REQUESTS = parseInt(process.env.RESET_MAX_IP_REQUESTS, 10) || 10;
const MAX_IDENTIFIER_REQUESTS = parseInt(process.env.RESET_MAX_IDENTIFIER_REQUESTS, 10) || 3;

function cleanOldEntries(map, now) {
  for (const [key, record] of map.entries()) {
    if (now - record.startTime > WINDOW_MS) {
      map.delete(key);
    }
  }
}

const passwordResetRateLimiter = (req, res, next) => {
  const now = Date.now();
  cleanOldEntries(ipRequestMap, now);
  cleanOldEntries(identifierRequestMap, now);

  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const identifier = req.body?.email || req.body?.phone || req.body?.identifier;

  // 1. Check IP limit
  const ipRecord = ipRequestMap.get(clientIp) || { count: 0, startTime: now };
  if (now - ipRecord.startTime > WINDOW_MS) {
    ipRecord.count = 0;
    ipRecord.startTime = now;
  }
  if (ipRecord.count >= MAX_IP_REQUESTS) {
    return res.status(429).json({
      message: "Too many password reset requests from this IP address. Please try again in 15 minutes.",
      retryAfterSeconds: Math.ceil((WINDOW_MS - (now - ipRecord.startTime)) / 1000),
    });
  }

  // 2. Check Identifier limit (Phone / Email)
  if (identifier) {
    const cleanId = String(identifier).trim().toLowerCase();
    const idRecord = identifierRequestMap.get(cleanId) || { count: 0, startTime: now };
    if (now - idRecord.startTime > WINDOW_MS) {
      idRecord.count = 0;
      idRecord.startTime = now;
    }
    if (idRecord.count >= MAX_IDENTIFIER_REQUESTS) {
      return res.status(429).json({
        message: "Too many password reset attempts for this account. Please wait 15 minutes before trying again.",
        retryAfterSeconds: Math.ceil((WINDOW_MS - (now - idRecord.startTime)) / 1000),
      });
    }

    idRecord.count += 1;
    identifierRequestMap.set(cleanId, idRecord);
  }

  ipRecord.count += 1;
  ipRequestMap.set(clientIp, ipRecord);

  next();
};

module.exports = {
  passwordResetRateLimiter,
};
