/**
 * Abstract KYC Provider Interface
 * All verification adapters (Mock, DigiLocker/API Setu, Aggregators) must implement this interface.
 */
class IKycAdapter {
  /**
   * Returns the provider identifier string (e.g. 'MOCK', 'DIGILOCKER_SETU')
   * @returns {string}
   */
  getProviderName() {
    throw new Error("Method getProviderName() must be implemented");
  }

  /**
   * Initiates a verification session and returns authorization URL parameters
   * @param {Object} params - { userId, callbackUrl, stateToken }
   * @returns {Promise<{ redirectUrl: string, codeVerifier?: string }>}
   */
  async initiateVerification(params) {
    throw new Error("Method initiateVerification() must be implemented");
  }

  /**
   * Processes OAuth callback and extracts verified identity metadata
   * @param {Object} params - { code, stateToken, codeVerifier }
   * @returns {Promise<{
   *   success: boolean,
   *   verifiedName: string,
   *   dob?: string,
   *   gender?: string,
   *   maskedAadhaar?: string,
   *   cleanAadhaar?: string,
   *   providerReferenceId?: string,
   *   reasonCode?: string,
   *   errorDetails?: string
   * }>}
   */
  async processCallback(params) {
    throw new Error("Method processCallback() must be implemented");
  }
}

module.exports = IKycAdapter;
