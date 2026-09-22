const MockKycAdapter = require("./MockKycAdapter");
const DigiLockerSetuAdapter = require("./DigiLockerSetuAdapter");

/**
 * Factory class for instantiating the active KYC Provider Adapter.
 * Includes strict production safety guards against enabling mock providers in production.
 */
class KycProviderFactory {
  static getProvider(overrideProvider) {
    const isProduction = process.env.NODE_ENV === "production";
    const providerName = overrideProvider || process.env.KYC_PROVIDER || "MOCK";

    // Guard 1: Prevent MOCK provider in production
    if (isProduction && providerName === "MOCK") {
      throw new Error("FATAL SECURITY VIOLATION: Mock KYC provider cannot be enabled in production mode!");
    }

    switch (providerName.toUpperCase()) {
      case "MOCK":
        return new MockKycAdapter();
      case "DIGILOCKER":
      case "DIGILOCKER_SETU":
      case "API_SETU":
        return new DigiLockerSetuAdapter();
      default:
        if (isProduction) {
          throw new Error(`FATAL SECURITY ERROR: Invalid or unapproved KYC provider '${providerName}' in production.`);
        }
        return new MockKycAdapter();
    }
  }
}

module.exports = KycProviderFactory;
