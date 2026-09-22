import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { processKycCallback } from "../api/profileApi";

function KycCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [statusState, setStatusState] = useState({
    loading: true,
    status: null,
    reasonCode: null,
    message: "Verifying OAuth response with server...",
    error: null
  });

  useEffect(() => {
    let isMounted = true;

    async function handleCallback() {
      const code = searchParams.get("code");
      const state = searchParams.get("state") || searchParams.get("stateToken");
      const errorParam = searchParams.get("error");
      const errorDesc = searchParams.get("error_description");

      if (!state) {
        if (isMounted) {
          setStatusState({
            loading: false,
            status: "FAILED",
            reasonCode: "MISSING_STATE",
            message: "Invalid callback URL. State verification token is missing.",
            error: true
          });
        }
        return;
      }

      try {
        const result = await processKycCallback({
          code,
          state,
          error: errorParam,
          error_description: errorDesc
        });

        if (isMounted) {
          setStatusState({
            loading: false,
            status: result.status,
            reasonCode: result.reasonCode,
            message: result.message || "Callback processed.",
            error: false
          });
        }
      } catch (err) {
        if (isMounted) {
          setStatusState({
            loading: false,
            status: "FAILED",
            reasonCode: err.response?.data?.reasonCode || "CALLBACK_ERROR",
            message: err.response?.data?.message || "Error processing verification callback.",
            error: true
          });
        }
      }
    }

    handleCallback();

    return () => {
      isMounted = false;
    };
  }, [searchParams]);

  return (
    <div style={containerStyle}>
      <div className="glass-card" style={cardStyle}>
        <h2>DigiLocker Identity Verification</h2>

        {statusState.loading && (
          <div style={{ margin: "2rem 0", textAlign: "center" }}>
            <div className="spinner" style={{ marginBottom: "1rem" }}>⏳</div>
            <p style={{ color: "var(--text-secondary)" }}>{statusState.message}</p>
          </div>
        )}

        {!statusState.loading && statusState.status === "VERIFIED" && (
          <div style={{ margin: "1.5rem 0", textAlign: "center" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>✅</div>
            <h3 style={{ color: "#10B981" }}>Identity Verified Successfully!</h3>
            <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem" }}>
              Your digital e-KYC status is active. You are eligible to join chit groups.
            </p>
          </div>
        )}

        {!statusState.loading && statusState.status === "REVIEW_REQUIRED" && (
          <div style={{ margin: "1.5rem 0", textAlign: "center" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
            <h3 style={{ color: "#F59E0B" }}>Admin Review Required</h3>
            <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem" }}>
              {statusState.message} Your verification has been submitted to the Admin Exception Queue for human review.
            </p>
          </div>
        )}

        {!statusState.loading && (statusState.status === "FAILED" || statusState.status === "NOT_STARTED" || statusState.error) && (
          <div style={{ margin: "1.5rem 0", textAlign: "center" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>❌</div>
            <h3 style={{ color: "#EF4444" }}>Verification Incomplete</h3>
            <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem" }}>
              {statusState.message}
            </p>
          </div>
        )}

        <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
          <button className="btn btn-secondary" onClick={() => navigate("/member")} style={{ flex: 1 }}>
            Go to Dashboard
          </button>
          <button className="btn btn-primary" onClick={() => navigate("/profile")} style={{ flex: 1 }}>
            View Profile
          </button>
        </div>
      </div>
    </div>
  );
}

const containerStyle = {
  minHeight: "80vh",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "2rem"
};

const cardStyle = {
  maxWidth: "500px",
  width: "100%",
  padding: "2.5rem",
  textAlign: "center"
};

export default KycCallbackPage;
