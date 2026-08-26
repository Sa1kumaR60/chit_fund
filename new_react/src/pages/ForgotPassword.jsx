import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { requestPasswordReset, verifyResetOtp, resetPassword } from "../api/authApi";

function ForgotPassword() {
  const navigate = useNavigate();

  // Steps: 1 (Request), 2 (OTP for Phone), 3 (New Password), 4 (Success)
  const [step, setStep] = useState(1);
  const [identifier, setIdentifier] = useState("");
  const [isPhoneChannel, setIsPhoneChannel] = useState(false);
  
  // OTP state
  const [otp, setOtp] = useState("");
  const [resetAuthToken, setResetAuthToken] = useState(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState(5);
  const [cooldown, setCooldown] = useState(0);

  // New Password State
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Status & Feedback
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [devLink, setDevLink] = useState("");

  // Countdown timers
  useEffect(() => {
    let timer;
    if (cooldown > 0) {
      timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleRequestSubmit = async (e) => {
    e.preventDefault();
    if (!identifier.trim()) {
      setErrorMessage("Please enter your registered Email or Phone number.");
      return;
    }

    setLoading(true);
    setErrorMessage("");
    setInfoMessage("");

    try {
      const isEmail = identifier.includes("@");
      setIsPhoneChannel(!isEmail);

      const res = await requestPasswordReset(identifier.trim());
      setInfoMessage(res.message);

      if (res.dev_otp) {
        setDevOtp(res.dev_otp);
      } else if (!isEmail && process.env.NODE_ENV !== 'production') {
        setInfoMessage(
          `No registered user found for '${identifier.trim()}'. Try entering a registered test phone: 9876543210 or 9876543211.`
        );
      }

      if (res.dev_link) setDevLink(res.dev_link);

      if (!isEmail) {
        // Proceed to OTP step for Phone
        setStep(2);
        setCooldown(60); // 60s resend cooldown
      } else {
        // Email instructions shown
        setInfoMessage("Reset link dispatched! If an account exists for this email, please check your inbox.");
      }
    } catch (err) {
      setErrorMessage(err.response?.data?.message || "Failed to process request. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otp.trim() || otp.trim().length !== 6) {
      setErrorMessage("Please enter the complete 6-digit OTP code.");
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      const res = await verifyResetOtp(identifier.trim(), otp.trim());
      setResetAuthToken(res.resetAuthToken);
      setStep(3); // Proceed to new password
    } catch (err) {
      if (err.response?.data?.attemptsRemaining !== undefined) {
        setAttemptsRemaining(err.response.data.attemptsRemaining);
      }
      setErrorMessage(err.response?.data?.message || "Invalid OTP code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    if (!newPassword || !confirmPassword) {
      setErrorMessage("Please fill in both password fields.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    if (newPassword.length < 8) {
      setErrorMessage("Password must be at least 8 characters long.");
      return;
    }

    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setErrorMessage("Password must contain at least one letter and one number.");
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      await resetPassword({
        resetAuthToken,
        newPassword,
      });
      setStep(4);
      setTimeout(() => navigate("/"), 3000);
    } catch (err) {
      setErrorMessage(err.response?.data?.message || "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", padding: "1.5rem" }}>
      <div className="glass-card form-card" style={{ margin: 0, width: "100%", maxWidth: "500px" }}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div className="nav-brand" style={{ fontSize: "1.75rem", justifyContent: "center", marginBottom: "0.5rem" }}>
            🪙 Smart Chit Fund
          </div>
          <h2 className="form-title" style={{ fontSize: "1.25rem", marginBottom: "0.25rem" }}>
            Password Recovery
          </h2>
        </div>

        {errorMessage && <div className="alert alert-danger" style={{ marginBottom: "1rem" }}>{errorMessage}</div>}
        {infoMessage && <div className="alert alert-success" style={{ marginBottom: "1rem" }}>{infoMessage}</div>}

        {devOtp && (
          <div className="alert alert-warning" style={{ marginBottom: "1rem", textAlign: "center", border: "1px dashed var(--warning)" }}>
            ⚡ <strong>[Dev Testing Mode]</strong> Your OTP Code is: <strong style={{ fontSize: "1.2rem", letterSpacing: "2px" }}>{devOtp}</strong>
          </div>
        )}

        {devLink && (
          <div className="alert alert-accent" style={{ marginBottom: "1rem", textAlign: "center" }}>
            ⚡ <strong>[Dev Testing Mode]</strong> <a href={devLink} style={{ color: "#fff", textDecoration: "underline" }}>Click here to open Reset Link</a>
          </div>
        )}

        {/* STEP 1: Request Password Reset */}
        {step === 1 && (
          <form onSubmit={handleRequestSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="identifier">
                Registered Email or Phone Number
              </label>
              <input
                id="identifier"
                type="text"
                className="form-input"
                placeholder="e.g. 9876543210 or user@gmail.com"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "1.5rem" }} disabled={loading}>
              {loading ? "Sending Instructions..." : "Send Reset Instructions"}
            </button>

            <div style={{ marginTop: "1.5rem", textAlign: "center" }}>
              <a href="/" style={{ color: "var(--text-secondary)", fontSize: "0.85rem", textDecoration: "none" }}>
                ← Return to Login
              </a>
            </div>
          </form>
        )}

        {/* STEP 2: Verify Phone OTP */}
        {step === 2 && isPhoneChannel && (
          <form onSubmit={handleVerifyOtp}>
            <div className="form-group">
              <label className="form-label" htmlFor="otp">
                Enter 6-Digit OTP Code
              </label>
              <input
                id="otp"
                type="text"
                maxLength="6"
                className="form-input"
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                style={{ fontSize: "1.5rem", letterSpacing: "0.5rem", textAlign: "center" }}
                required
              />
              <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.5rem", display: "block" }}>
                Verification attempts remaining: <strong>{attemptsRemaining} / 5</strong>
              </span>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "1rem" }} disabled={loading}>
              {loading ? "Verifying..." : "Verify Code"}
            </button>

            <div style={{ marginTop: "1rem", textAlign: "center" }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={cooldown > 0 || loading}
                onClick={handleRequestSubmit}
                style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
              >
                {cooldown > 0 ? `Resend OTP in ${cooldown}s` : "Resend OTP Code"}
              </button>
            </div>
          </form>
        )}

        {/* STEP 3: Enter New Password */}
        {step === 3 && (
          <form onSubmit={handleResetSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="newPassword">New Password</label>
              <input
                id="newPassword"
                type="password"
                className="form-input"
                placeholder="At least 8 characters (letters & numbers)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>

            <div className="form-group" style={{ marginTop: "1rem" }}>
              <label className="form-label" htmlFor="confirmPassword">Confirm New Password</label>
              <input
                id="confirmPassword"
                type="password"
                className="form-input"
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "1.5rem" }} disabled={loading}>
              {loading ? "Updating Password..." : "Set New Password"}
            </button>
          </form>
        )}

        {/* STEP 4: Success Confirmation */}
        {step === 4 && (
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🎉</div>
            <h3 style={{ color: "var(--success)", marginBottom: "0.5rem" }}>Password Reset Successful!</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              Your password has been changed and all prior active sessions have been revoked. Redirecting to Login...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ForgotPassword;
