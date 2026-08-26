import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getChits } from "../api/chitApi";

function ViewChits() {
  const [chits, setChits] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const loadChits = async () => {
      try {
        const data = await getChits();
        setChits(Array.isArray(data) ? data : []);
        setErrorMessage("");
      } catch (error) {
        console.error(error);
        setChits([]);
        setErrorMessage(
          error.response?.data?.message ||
            "Unable to load active chit groups for this account."
        );
      }
    };

    loadChits();
  }, []);

  return (
    <div>
      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-brand">🪙 Smart Chit Fund</div>
        <div className="nav-links">
          <button className="btn btn-secondary" onClick={() => navigate("/member")}>
            Dashboard
          </button>
        </div>
      </nav>

      <div className="glass-container">
        <div className="view-header">
          <div className="view-title-area">
            <h1>Browse Active Chit Groups</h1>
            <p className="view-subtitle">Explore available savings circles, examine installment durations, and join new schemes.</p>
          </div>
        </div>

        {errorMessage && <div className="alert alert-danger">{errorMessage}</div>}

        {!errorMessage && chits.length === 0 ? (
          <div className="glass-card text-center" style={{ padding: "4rem 0" }}>
            <p style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>No joined or invited chit groups found at this moment.</p>
          </div>
        ) : (
          <div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.5rem" }}>
            {chits.map((chit) => (
              <div key={chit.chit_id} className="glass-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <span className="badge badge-primary">Chit #{chit.chit_id}</span>
                    <span className={`badge ${chit.membership_status ? 'badge-success' : 'badge-warning'}`}>
                      {chit.membership_status ? "Joined" : "Invited"}
                    </span>
                  </div>

                  <span className="stat-label" style={{ fontSize: "0.75rem" }}>Total Pool Value</span>
                  <h3 style={{ fontSize: "1.75rem", color: "var(--text-primary)", fontFamily: "var(--font-display)", fontWeight: "800", marginBottom: "0.5rem" }}>
                    ₹{Number(chit.chit_value).toLocaleString("en-IN")}
                  </h3>

                  <div style={{ background: "rgba(255, 255, 255, 0.02)", padding: "0.75rem", borderRadius: "var(--radius-sm)", marginBottom: "1rem" }}>
                    <div className="flex-between" style={{ fontSize: "0.85rem", marginBottom: "0.4rem" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Monthly Installment:</span>
                      <strong style={{ color: "var(--accent)" }}>₹{Number(chit.monthly_installment).toLocaleString("en-IN")}</strong>
                    </div>
                    <div className="flex-between" style={{ fontSize: "0.85rem", marginBottom: "0.4rem" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Duration:</span>
                      <strong style={{ color: "var(--text-primary)" }}>{chit.duration_months} Months</strong>
                    </div>
                    <div className="flex-between" style={{ fontSize: "0.85rem" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Members:</span>
                      <strong>{chit.joined_members} / {chit.total_members}</strong>
                    </div>
                  </div>

                  <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "1.5rem" }}>
                    Admin: <strong>{chit.admin_name}</strong> | Starts: <strong>{new Date(chit.start_date).toLocaleDateString("en-IN")}</strong>
                  </p>
                </div>

                <button
                  className="btn btn-primary"
                  style={{ width: "100%" }}
                  onClick={() => navigate(`/chits/${chit.chit_id}`)}
                >
                  {chit.membership_status ? "View Group Details" : "View Invitation Details"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ViewChits;
