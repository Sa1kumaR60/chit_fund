import { useState } from "react";
import { initiateKyc } from "../api/profileApi";

function KYCModal({ onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleStartDigiLocker = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await initiateKyc();
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl;
      } else {
        setError("Failed to obtain provider authorization URL.");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to initiate DigiLocker verification.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle} className="glass-card">
        <h2 style={{ marginBottom: "1rem" }}>Identity Verification Required</h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
          To join chit groups, verify your identity securely via <strong>DigiLocker / API Setu</strong>.
        </p>

        {error && <div className="alert alert-danger" style={{ marginBottom: "1rem" }}>{error}</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", margin: "1.5rem 0" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading}
            onClick={handleStartDigiLocker}
            style={{ padding: "0.85rem", fontSize: "1rem", fontWeight: "600", display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem" }}
          >
            {loading ? "Connecting to DigiLocker..." : "🔒 Verify Identity via DigiLocker"}
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.5rem" }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ flex: 1 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100vw",
  height: "100vh",
  backgroundColor: "rgba(0,0,0,0.7)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 1000,
  backdropFilter: "blur(5px)",
};

const modalStyle = {
  width: "100%",
  maxWidth: "450px",
  padding: "2rem",
};

export default KYCModal;
