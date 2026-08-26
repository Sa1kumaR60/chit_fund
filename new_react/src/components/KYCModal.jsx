import { useState } from "react";
import { submitKyc } from "../api/authApi";

function KYCModal({ onClose, onSuccess }) {
  const [aadhar, setAadhar] = useState("");
  const [pan, setPan] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!aadhar || !pan) {
      setError("Please provide Aadhar and PAN.");
      return;
    }
    setLoading(true);
    try {
      await submitKyc({
        aadhar_number: aadhar,
        pan_number: pan,
      });
      onSuccess();
    }
     catch (err) {
      setError(err.response?.data?.message || "KYC verification failed.");
    }
     finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle} className="glass-card">
        <h2 style={{ marginBottom: "1rem" }}>KYC Verification Required</h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
          For app security, please verify your identity before joining this chit group.
        </p>

        {error && <div className="alert alert-danger" style={{ marginBottom: "1rem" }}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem" }}>Aadhar Number</label>
            <input
              type="text"
              className="modern-input"
              value={aadhar}
              onChange={(e) => setAadhar(e.target.value)}
              placeholder="XXXX XXXX XXXX"
              inputMode="numeric"
              maxLength="14"
              required
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem" }}>PAN Number</label>
            <input
              type="text"
              className="modern-input"
              value={pan}
              onChange={(e) => setPan(e.target.value.toUpperCase())}
              placeholder="ABCDE1234F"
              maxLength="10"
              required
            />
          </div>
          
          <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} style={{ flex: 1 }}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
              {loading ? "Verifying..." : "Submit KYC"}
            </button>
          </div>
        </form>
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
