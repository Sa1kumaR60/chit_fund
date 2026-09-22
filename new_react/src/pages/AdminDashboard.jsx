import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAdminDashboard } from "../api/dashboardApi";
import { getWalletDetails } from "../api/walletApi";
import { adminResetMemberPassword } from "../api/authApi";

function AdminDashboard() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [user] = useState(() => {
    const localUser = localStorage.getItem("user");
    return localUser ? JSON.parse(localUser) : null;
  });

  const handleAdminResetPassword = async (memberId, memberName) => {
    if (!window.confirm(`Initiate secure password reset for member ${memberName}? A reset code will be dispatched directly to their phone/email.`)) {
      return;
    }
    setResetLoading(true);
    try {
      const res = await adminResetMemberPassword(memberId);
      alert(res.message || "Password reset initiated successfully!");
    } catch (err) {
      alert(err.response?.data?.message || "Failed to initiate password reset.");
    } finally {
      setResetLoading(false);
    }
  };

  const loadData = async () => {
    try {
      const dbData = await getAdminDashboard();
      setDashboard(dbData);
      
      const walletData = await getWalletDetails();
      setWallet(walletData.wallet);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error.response?.data?.message || "Unable to retrieve admin dashboard analytics."
      );
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(loadData, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const logout = () => {
    localStorage.clear();
    navigate("/");
  };

  const money = (value) =>
    Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });

  return (
    <div>
      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-brand">🪙 Smart Chit Fund</div>
        <div className="nav-links">
          <div className="nav-user">
            <span>Admin: <strong>{user?.name || "Administrator"}</strong></span>
            <span style={{ color: "var(--text-muted)" }}>|</span>
            <span>Console</span>
          </div>
          <button className="btn btn-secondary" onClick={() => navigate("/profile")}>👤 Admin Profile</button>
          <button className="btn btn-secondary" onClick={() => navigate("/wallet")}>Commission Wallet</button>
          <button className="btn btn-danger" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }} onClick={logout}>Logout</button>
        </div>
      </nav>

      <div className="glass-container">
        {/* Header */}
        <div className="view-header">
          <div className="view-title-area">
            <h1>Admin Management Dashboard</h1>
            <p className="view-subtitle">Supervise chit groups, monitor defaults, initiate monthly bidding auctions, and audit dues.</p>
          </div>
          <div className="btn-group">
            <button className="btn btn-primary" onClick={() => navigate("/create-chit")}>Create New Chit Group</button>
            <button className="btn btn-secondary" onClick={() => navigate("/payments")}>Track Member Dues</button>
            <button className="btn btn-secondary" onClick={() => navigate("/auctions")}>Manage Live Auctions</button>
            <button className="btn btn-secondary" onClick={() => navigate("/monthly-reports")}>Monthly Reports</button>
          </div>
        </div>

        {errorMessage && <div className="alert alert-danger">{errorMessage}</div>}

        {dashboard && (
          <>
            <div className="glass-card mb-8">
              <h2 className="mb-4">Real-Time Cash Position</h2>
              <div className="stats-grid" style={{ marginBottom: 0 }}>
                <div className="stat-card success">
                  <span className="stat-label">Total Collected</span>
                  <span className="stat-value" style={{ color: "var(--success)" }}>
                    ₹{money(dashboard.finance?.total_collected)}
                  </span>
                </div>
                <div className="stat-card warning">
                  <span className="stat-label">Locked Auction Amount</span>
                  <span className="stat-value" style={{ color: "var(--warning)" }}>
                    ₹{money(dashboard.finance?.locked_auction_amount)}
                  </span>
                </div>
                <div className="stat-card accent">
                  <span className="stat-label">Reserve Fund</span>
                  <span className="stat-value" style={{ color: "var(--accent)" }}>
                    ₹{money(dashboard.finance?.reserve_fund)}
                  </span>
                </div>
                <div className="stat-card primary">
                  <span className="stat-label">Available Balance</span>
                  <span className="stat-value">
                    ₹{money(dashboard.finance?.available_balance)}
                  </span>
                </div>
                <div className="stat-card success">
                  <span className="stat-label">Commission Earned</span>
                  <span className="stat-value" style={{ color: "var(--success)" }}>
                    ₹{money(dashboard.finance?.commission_earned)}
                  </span>
                </div>
                <div className="stat-card danger">
                  <span className="stat-label">Pending Installments</span>
                  <span className="stat-value" style={{ color: "var(--danger)" }}>
                    ₹{money(dashboard.finance?.pending_installments)}
                  </span>
                </div>
              </div>
            </div>

            {/* Stats Block */}
            <div className="stats-grid">
              <div className="stat-card accent" onClick={() => navigate("/wallet")} style={{ cursor: "pointer" }}>
                <span className="stat-label">Admin Commission Earnings</span>
                <span className="stat-value" style={{ color: "var(--accent)" }}>
                  ₹{wallet ? Number(wallet.balance).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "0.00"}
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  5% organizer dues accumulated
                </span>
              </div>

              <div className="stat-card primary">
                <span className="stat-label">Total Chit Groups</span>
                <span className="stat-value">{dashboard.totals.totalChits}</span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  Managed chit schemes
                </span>
              </div>

              <div className="stat-card success">
                <span className="stat-label">Enrolled Members</span>
                <span className="stat-value" style={{ color: "var(--success)" }}>
                  {dashboard.totals.totalMembers}
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  Active participants
                </span>
              </div>

              <div className="stat-card danger">
                <span className="stat-label">Defaulter Streaks</span>
                <span className="stat-value" style={{ color: "var(--danger)" }}>
                  {dashboard.totals.totalDefaulters}
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  Members with missed installments
                </span>
              </div>
            </div>

            {/* Managed Chits Table */}
            <div className="glass-card mb-8">
              <h2 className="mb-4">Organized Chit Groups</h2>
              {dashboard.chits.length === 0 ? (
                <div className="text-center" style={{ padding: "3rem 0" }}>
                  <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem" }}>No chit groups created yet.</p>
                  <button className="btn btn-primary" onClick={() => navigate("/create-chit")}>Launch First Group</button>
                </div>
              ) : (
                <div className="table-container" style={{ border: "none", margin: 0 }}>
                  <table className="modern-table">
                    <thead>
                      <tr>
                        <th>Chit ID</th>
                        <th>Chit Value</th>
                        <th>Monthly Installment</th>
                        <th>Members Joined</th>
                        <th>Status</th>
                        <th>Active Defaulters</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.chits.map((chit) => (
                        <tr key={chit.chit_id}>
                          <td><code>#{chit.chit_id}</code></td>
                          <td>₹{Number(chit.chit_value).toLocaleString("en-IN")}</td>
                          <td>₹{Number(chit.monthly_installment).toLocaleString("en-IN")}</td>
                          <td>
                            <strong style={{ color: "var(--text-primary)" }}>{chit.joined_members}</strong>
                            <span style={{ color: "var(--text-muted)" }}> / {chit.total_members}</span>
                          </td>
                          <td>
                            <span className={`badge ${chit.status === "ACTIVE" ? "badge-success" : "badge-danger"}`}>
                              {chit.status}
                            </span>
                          </td>
                          <td style={{ color: chit.defaulter_count > 0 ? "var(--danger)" : "var(--text-muted)" }}>
                            {chit.defaulter_count} flagged
                          </td>
                          <td className="text-right">
                            <button
                              className="btn btn-secondary"
                              style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                              onClick={() => navigate(`/chits/${chit.chit_id}`)}
                            >
                              View Details
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Split layout: Defaulters & Open Auctions */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
              
              {/* Defaulter Alerts */}
              <div className="glass-card">
                <h2 className="mb-4" style={{ color: "var(--danger)" }}>Defaulter Escalation Center</h2>
                {dashboard.defaulters.length === 0 ? (
                  <div className="text-center" style={{ padding: "2.5rem 0" }}>
                    <p style={{ color: "var(--text-muted)" }}>All active members have paid their monthly dues on time!</p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {dashboard.defaulters.map((member) => (
                      <div
                        key={`${member.chit_id}-${member.member_id}`}
                        className="alert alert-danger"
                        style={{ margin: 0, padding: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                      >
                        <div>
                          <strong style={{ color: "#fff" }}>{member.name}</strong> ({member.phone})
                          <p style={{ fontSize: "0.8rem", color: "#fecaca", marginTop: "0.25rem" }}>
                            Chit Group: <strong>#{member.chit_id}</strong>
                          </p>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span className="badge badge-danger" style={{ display: "block", marginBottom: "0.25rem" }}>{member.unpaid_streak} Months Unpaid</span>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                            disabled={resetLoading}
                            onClick={() => handleAdminResetPassword(member.member_id, member.name)}
                          >
                            Reset Password
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Open Auctions queue */}
              <div className="glass-card">
                <h2 className="mb-4">Active & Open Auctions</h2>
                {dashboard.open_auctions.length === 0 ? (
                  <div className="text-center" style={{ padding: "2.5rem 0" }}>
                    <p style={{ color: "var(--text-muted)" }}>No live bidding rounds are currently active.</p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {dashboard.open_auctions.map((auction) => (
                      <div
                        key={auction.auction_id}
                        className="glass-card live-auction-card"
                        style={{ padding: "1rem", margin: 0, background: "rgba(10, 15, 30, 0.3)", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                      >
                        <div>
                          <span className="badge badge-warning" style={{ marginBottom: "0.5rem" }}>Bidding Active</span>
                          <p style={{ fontSize: "0.9rem" }}>
                            Auction <strong>#{auction.auction_id}</strong> | Chit <strong>#{auction.chit_id}</strong>
                          </p>
                          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                            Installment Month: <strong>#{auction.installment_number}</strong>
                          </p>
                        </div>
                        <button
                          className="btn btn-primary"
                          style={{ padding: "0.5rem 1rem", fontSize: "0.8rem" }}
                          onClick={() => navigate("/auctions")}
                        >
                          Go to Live Panel
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default AdminDashboard;
