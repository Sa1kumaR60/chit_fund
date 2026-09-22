const IKycAdapter = require("./IKycAdapter");

/**
 * Local Development Mock Adapter
 * Simulates offline DigiLocker authentication with synthetic identities.
 */
class MockKycAdapter extends IKycAdapter {
  getProviderName() {
    return "MOCK";
  }

  async initiateVerification({ userId, callbackUrl, stateToken }) {
    // In local development, redirect back to the client callback page with synthetic code and state
    const frontendCallbackUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const redirectUrl = `${frontendCallbackUrl}/kyc/callback?code=mock_authorization_code_sandbox&state=${encodeURIComponent(stateToken)}`;
    
    return {
      redirectUrl
    };
  }

  async processCallback({ code, stateToken, mockName }) {
    if (!code || code.includes("error") || code.includes("cancel")) {
      return {
        success: false,
        reasonCode: "USER_CANCELLED",
        errorDetails: "User cancelled or failed authentication during mock flow"
      };
    }

    // Return synthetic e-KYC metadata for local testing
    return {
      success: true,
      verifiedName: mockName || "SAI KUMAR",
      dob: "1995-05-15",
      gender: "M",
      maskedAadhaar: "XXXX-XXXX-9901",
      cleanAadhaar: "999988889901",
      providerReferenceId: `MOCK-REF-${Date.now()}`
    };
  }
}

module.exports = MockKycAdapter;
