/**
 * Conservative Name Matcher Utility for Identity Verification
 * Enforces deterministic normalization, exact matches, and order-independent token set matches.
 * Questionable initial expansions or ambiguous names are flagged for REVIEW_REQUIRED.
 */

const HONORIFICS = new Set(["MR", "MRS", "MS", "MISS", "DR", "SRI", "SMT", "SHRI", "SHRIMATI"]);

/**
 * Normalizes a name string by removing honorifics, punctuation, and extra whitespace.
 * @param {string} name 
 * @returns {string} Normalized uppercase string
 */
function normalizeName(name) {
  if (!name || typeof name !== "string") return "";
  
  // 1. Uppercase & trim
  let clean = name.trim().toUpperCase();

  // 2. Replace punctuation with space
  clean = clean.replace(/[^A-Z0-9\s]/g, " ");

  // 3. Tokenize
  const tokens = clean.split(/\s+/).filter(Boolean);

  // 4. Remove leading honorifics
  const filteredTokens = tokens.filter((token, index) => {
    if (index === 0 && HONORIFICS.has(token)) return false;
    return true;
  });

  return filteredTokens.join(" ");
}

/**
 * Compares a profile name with a provider-verified e-KYC name conservatively.
 * @param {string} profileName - User name registered on platform
 * @param {string} verifiedName - Name returned by e-KYC provider
 * @returns {{ match: boolean, confidence: 'EXACT' | 'TOKEN_SET' | 'AMBIGUOUS' | 'MISMATCH', reasonCode: string }}
 */
function compareNames(profileName, verifiedName) {
  const normProfile = normalizeName(profileName);
  const normVerified = normalizeName(verifiedName);

  if (!normProfile || !normVerified) {
    return {
      match: false,
      confidence: "MISMATCH",
      reasonCode: "NAME_MISMATCH_REVIEW_REQUIRED"
    };
  }

  // Rule 1: Exact Normalized Match
  if (normProfile === normVerified) {
    return {
      match: true,
      confidence: "EXACT",
      reasonCode: "NAME_MATCH_EXACT"
    };
  }

  // Rule 2: Order-Independent Token Set Equality (e.g. "SAI KUMAR REDDY" vs "REDDY SAI KUMAR")
  const profileTokens = normProfile.split(" ").sort();
  const verifiedTokens = normVerified.split(" ").sort();

  if (profileTokens.length === verifiedTokens.length &&
      profileTokens.every((token, idx) => token === verifiedTokens[idx])) {
    return {
      match: true,
      confidence: "TOKEN_SET",
      reasonCode: "NAME_MATCH_TOKEN_SET"
    };
  }

  // Check for Ambiguity (e.g., initial expansions like "S KUMAR" vs "SAI KUMAR")
  const hasSingleLetterToken = profileTokens.some(t => t.length === 1) || verifiedTokens.some(t => t.length === 1);
  const isSubset = profileTokens.every(t => verifiedTokens.includes(t)) || verifiedTokens.every(t => profileTokens.includes(t));

  if (hasSingleLetterToken || isSubset) {
    return {
      match: false,
      confidence: "AMBIGUOUS",
      reasonCode: "NAME_AMBIGUOUS_REVIEW_REQUIRED"
    };
  }

  // Default: Discrepancy / Mismatch
  return {
    match: false,
    confidence: "MISMATCH",
    reasonCode: "NAME_MISMATCH_REVIEW_REQUIRED"
  };
}

module.exports = {
  normalizeName,
  compareNames
};
