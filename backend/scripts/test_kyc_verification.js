const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { compareNames } = require("../utils/nameMatcher");
const KycProviderFactory = require("../services/kyc/KycProviderFactory");

function runTests() {
  console.log("🧪 Running KYC Unit & Security Tests...\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // 1. Name Matcher Tests
  console.log("--- 1. Conservative Name Matcher Tests ---");

  const exact = compareNames("SAI KUMAR REDDY", "Sai Kumar Reddy");
  assert(exact.match === true && exact.confidence === "EXACT", "Exact name match normalized case");

  const tokenSet = compareNames("SAI KUMAR REDDY", "REDDY SAI KUMAR");
  assert(tokenSet.match === true && tokenSet.confidence === "TOKEN_SET", "Order-independent token set match");

  const initialAmbiguous = compareNames("S KUMAR", "SAI KUMAR");
  assert(initialAmbiguous.match === false && initialAmbiguous.confidence === "AMBIGUOUS", "Ambiguous initial expansion routed to REVIEW_REQUIRED");

  const honorific = compareNames("MR SAI KUMAR", "SAI KUMAR");
  assert(honorific.match === true && honorific.confidence === "EXACT", "Honorific prefix stripped during normalization");

  const mismatch = compareNames("SAI KUMAR", "RAMESH BABU");
  assert(mismatch.match === false && mismatch.confidence === "MISMATCH", "Completely different name rejected");

  // 2. Production Safety Guard Test
  console.log("\n--- 2. Production Guard Security Tests ---");
  const oldNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  let guardTriggered = false;
  try {
    KycProviderFactory.getProvider("MOCK");
  } catch (err) {
    guardTriggered = err.message.includes("FATAL SECURITY VIOLATION");
  }
  assert(guardTriggered, "Mock provider refused in production mode");

  process.env.NODE_ENV = oldNodeEnv;

  // 3. Mock Adapter Flow Test
  console.log("\n--- 3. Mock Provider Integration Test ---");
  const provider = KycProviderFactory.getProvider("MOCK");
  assert(provider.getProviderName() === "MOCK", "Mock provider instantiated cleanly");

  console.log(`\nResults: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) process.exit(1);
}

runTests();
