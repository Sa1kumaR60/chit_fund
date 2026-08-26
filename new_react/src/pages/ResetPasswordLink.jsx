import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { resetPassword } from "../api/authApi";

function ResetPasswordLink() {
  const navigate = useNavigate();
  const [token, setToken] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Capture token from URL query string
    const urlParams = new URLSearchParams(window.location.search);
    const rawToken = urlParams.get("token");

    if (rawToken) {
      setToken(rawToken);
      // Immediately strip raw token from visible browser URL to prevent leakage
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      setErrorMessage("No valid reset token found in link.");
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) {
      setErrorMessage("Missing or invalid reset token.");
      return;
    }

    if (!newPassword || !confirmPassword) {
      setErrorMessage("Please fill in all fields.");
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
        token,
        newPassword,
      });
      setSuccess(true);
      setTimeout(() => navigate("/"), 3000);
    } catch (err) {
      setErrorMessage(err.response?.data?.message || "Invalid or expired reset token.");
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
          <h2 className="form-title" style={{ fontSize: "1.25rem" }}>Reset Your Password</h2>
        </div>

        {errorMessage && <div className="alert alert-danger" style={{ marginBottom: "1rem" }}>{errorMessage}</div>}

        {success ? (
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🎉</div>
            <h3 style={{ color: "var(--success)", marginBottom: "0.5rem" }}>Password Reset Successful!</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              Your new password has been saved and all active sessions revoked. Redirecting to Login...
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
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

            <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "1.5rem" }} disabled={loading || !token}>
              {loading ? "Updating..." : "Save New Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default ResetPasswordLink;
