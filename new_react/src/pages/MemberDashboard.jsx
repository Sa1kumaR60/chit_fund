import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMemberDashboard } from "../api/dashboardApi";
import { getWalletDetails } from "../api/walletApi";
import {
  getInvitations,
  acceptInvitation,
  getNotifications,
  markNotificationAsRead,
} from "../api/chitApi";
import KYCModal from "../components/KYCModal";

function MemberDashboard() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [invitations, setInvitations] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [user] = useState(() => {
    const localUser = localStorage.getItem("user");
    return localUser ? JSON.parse(localUser) : null;
  });
  const [notifications, setNotifications] = useState([]);
  const [showKyc, setShowKyc] = useState(false);
  const [currentInviteId, setCurrentInviteId] = useState(null);

  const [tokenInput, setTokenInput] = useState("");
  const [tokenClaiming, setTokenClaiming] = useState(false);

  const loadData = async () => {
    try {
      const dbData = await getMemberDashboard();
      setDashboard(dbData);
      
      const walletData = await getWalletDetails();
      setWallet(walletData.wallet);

      const invs = await getInvitations();
      setInvitations(invs);

      const notifs = await getNotifications();
      setNotifications(notifs);

      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error.response?.data?.message || "Unable to load member dashboard details at this moment."
      );
    }
  };

  const handleClaimToken = async (e) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    setTokenClaiming(true);
    try {
      const { claimInviteToken } = await import("../api/chitApi");
      const res = await claimInviteToken(tokenInput.trim());
      alert(res.message || "Invitation claimed successfully!");
      setTokenInput("");
      loadData();
    } catch (err) {
      alert(err.response?.data?.message || "Invalid or expired invitation token.");
    } finally {
      setTokenClaiming(false);
    }
  };

  const handleAcceptInvite = async (invitationId) => {
    try {
      await acceptInvitation(invitationId);
      alert("Invitation accepted! You are now a member of the chit group.");
      loadData();
    } catch (error) {
      if (error.response?.data?.requiresKyc) {
        setCurrentInviteId(invitationId);
        setShowKyc(true);
      } else {
        alert(error.response?.data?.message || "Failed to accept invitation.");
      }
    }
  };

  const handleKycSuccess = async () => {
    setShowKyc(false);
    alert("KYC verified successfully!");
    if (currentInviteId) {
      await handleAcceptInvite(currentInviteId);
    }
  };

  const handleMarkAsRead = async (id) => {
    try {
      await markNotificationAsRead(id);
      setNotifications(notifications.map(n => n.notification_id === id ? { ...n, is_read: 1 } : n));
    } catch (e) {
      console.error(e);
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

  return (
    <div>
      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-brand">🪙 Smart Chit Fund</div>
        <div className="nav-links">
          <div className="nav-user">
            <span>Welcome, <strong>{user?.name || "Member"}</strong></span>
            <span style={{ color: "var(--text-muted)" }}>|</span>
            <span>ID: <code>#{user?.id}</code></span>
          </div>
          <button className="btn btn-secondary" onClick={() => navigate("/wallet")}>My Wallet</button>
          <button className="btn btn-danger" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }} onClick={logout}>Logout</button>
        </div>
      </nav>

      <div className="glass-container">
        {/* Header */}
        <div className="view-header">
          <div className="view-title-area">
            <h1>Member Dashboard</h1>
            <p className="view-subtitle">Monitor your chit memberships, dues, transaction history, and active bidding auctions.</p>
          </div>
          <div className="btn-group">
            <button className="btn btn-secondary" onClick={() => navigate("/payments")}>Make Installment Payment</button>
            <button className="btn btn-secondary" onClick={() => navigate("/auctions")}>Participate in Auctions</button>
          </div>
        </div>

        {errorMessage && <div className="alert alert-danger">{errorMessage}</div>}

        {/* Top level stats */}
        {dashboard && (
          <>
            <div className="stats-grid">
              <div className="stat-card success" onClick={() => navigate("/wallet")} style={{ cursor: "pointer" }}>
                <span className="stat-label">Wallet Balance</span>
                <span className="stat-value" style={{ color: "var(--success)" }}>
                  ₹{wallet ? Number(wallet.balance).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "0.00"}
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  Click to manage wallet
                </span>
              </div>

              <div className="stat-card primary">
                <span className="stat-label">Joined Chits</span>
                <span className="stat-value">{dashboard.totals.joinedChits}</span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  Active contributing groups
                </span>
              </div>

              <div className="stat-card info" style={{ borderLeft: "4px solid var(--primary)" }}>
                <span className="stat-label">Merit Score</span>
                <span className="stat-value" style={{ color: "var(--primary)", fontSize: "1.2rem" }}>
                  {dashboard.user_profile?.merit_score ?? 100}%
                  <span style={{ fontSize: "0.9rem", marginLeft: "8px", fontWeight: "normal" }}>
                    ({(dashboard.user_profile?.merit_score ?? 100) >= 90 ? 'Excellent' : (dashboard.user_profile?.merit_score ?? 100) >= 70 ? 'Good' : (dashboard.user_profile?.merit_score ?? 100) >= 50 ? 'Risk' : 'Defaulter'})
                  </span>
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  Payment Discipline Status
                </span>
              </div>

              <div className="stat-card danger" onClick={() => navigate("/payments")} style={{ cursor: "pointer" }}>
                <span className="stat-label">Pending Dues</span>
                <span className="stat-value" style={{ color: "var(--danger)" }}>
                  ₹{Number(dashboard.totals.pendingDues).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  Immediate unpaid dues
                </span>
              </div>

              <div className="stat-card warning">
                <span className="stat-label">Penalties Applied</span>
                <span className="stat-value" style={{ color: "var(--warning)" }}>
                  ₹{Number(dashboard.totals.penaltyTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  Late fees & defaults
                </span>
              </div>
            </div>

            {/* Claim Invitation Code Box */}
            <div className="glass-card" style={{ marginTop: "2rem", padding: "1.25rem", background: "rgba(255,255,255,0.02)" }}>
              <h3 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>🎟️ Have an Invitation Token or Payout Month Slot?</h3>
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                If an administrator sent you a token or invited your phone number to a Fixed/Auction Chit Group, enter it below to claim your slot.
              </p>
              <form onSubmit={handleClaimToken} style={{ display: "flex", gap: "1rem" }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Paste Invitation Token or Code..."
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-primary" type="submit" disabled={tokenClaiming}>
                  {tokenClaiming ? "Claiming..." : "Claim Slot"}
                </button>
              </form>
            </div>

            {/* Pending Invitations section */}
            {invitations.length > 0 && (
              <div className="glass-card" style={{ marginTop: "2rem", borderLeft: "4px solid var(--accent)" }}>
                <h2 className="mb-4">Pending Invitations</h2>
                <div className="table-container" style={{ border: "none", margin: 0 }}>
                  <table className="modern-table">
                    <thead>
                      <tr>
                        <th>Chit ID</th>
                        <th>Organizer</th>
                        <th>Total Value</th>
                        <th>Installment</th>
                        <th className="text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invitations.map((invite) => (
                        <tr key={invite.invitation_id}>
                          <td><code>#{invite.chit_id}</code></td>
                          <td><strong>{invite.admin_name}</strong></td>
                          <td>₹{Number(invite.chit_value).toLocaleString("en-IN")}</td>
                          <td>₹{Number(invite.monthly_installment).toLocaleString("en-IN")} /mo</td>
                          <td className="text-right">
                            <button
                              className="btn btn-success"
                              style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                              onClick={() => handleAcceptInvite(invite.invitation_id)}
                            >
                              Accept & Join
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Notifications Section */}
            {notifications.length > 0 && (
              <div className="glass-card" style={{ marginTop: "2rem", borderLeft: "4px solid var(--info)" }}>
                <h2 className="mb-4">Recent Notifications</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {notifications.slice(0, 5).map(n => (
                    <div key={n.notification_id} style={{ 
                      padding: "1rem", 
                      background: n.is_read ? "rgba(10, 15, 30, 0.2)" : "rgba(10, 15, 30, 0.6)", 
                      borderRadius: "0.5rem",
                      display: "flex", justifyContent: "space-between", alignItems: "center"
                    }}>
                      <div>
                        <span className={`badge ${n.type === 'REMINDER' ? 'badge-warning' : 'badge-primary'}`} style={{ marginRight: '0.5rem' }}>{n.type}</span>
                        <span style={{ color: n.is_read ? "var(--text-muted)" : "var(--text-primary)" }}>{n.message}</span>
                      </div>
                      {!n.is_read && (
                        <button className="btn btn-secondary" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }} onClick={() => handleMarkAsRead(n.notification_id)}>
                          Mark Read
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Split layout: Joined Chits and Open Auctions */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "2rem", marginTop: "2rem" }}>
              
              {/* My Chits section */}
              <div className="glass-card">
                <h2 className="mb-4">My Chit Group Memberships</h2>
                {dashboard.memberships.length === 0 ? (
                  <div className="text-center" style={{ padding: "3rem 0" }}>
                    <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem" }}>You haven't joined any chit groups yet.</p>
                  </div>
                ) : (
                  <div className="table-container" style={{ border: "none", margin: 0 }}>
                    <table className="modern-table">
                      <thead>
                        <tr>
                          <th>Chit ID</th>
                          <th>Total Value</th>
                          <th>Installment</th>
                          <th>Pending Dues</th>
                          <th>Late Fees</th>
                          <th className="text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.memberships.map((membership) => (
                          <tr key={membership.chit_id}>
                            <td><code>#{membership.chit_id}</code></td>
                            <td>₹{Number(membership.chit_value).toLocaleString("en-IN")}</td>
                            <td>₹{Number(membership.monthly_installment).toLocaleString("en-IN")} /mo</td>
                            <td style={{ color: membership.summary.pendingDues > 0 ? "var(--danger)" : "var(--text-primary)" }}>
                              ₹{Number(membership.summary.pendingDues).toLocaleString("en-IN")}
                            </td>
                            <td style={{ color: membership.summary.penaltyTotal > 0 ? "var(--warning)" : "var(--text-muted)" }}>
                              ₹{Number(membership.summary.penaltyTotal).toLocaleString("en-IN")}
                            </td>
                            <td className="text-right">
                              <button
                                className="btn btn-secondary"
                                style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                                onClick={() => navigate(`/chits/${membership.chit_id}`)}
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

              {/* Open Auctions section */}
              <div className="glass-card" style={{ display: "flex", flexDirection: "column" }}>
                <h2 className="mb-4">Live Open Auctions</h2>
                {dashboard.open_auctions.length === 0 ? (
                  <div className="text-center" style={{ padding: "3rem 0", margin: "auto" }}>
                    <p style={{ color: "var(--text-muted)" }}>No live auctions are currently open for your chits.</p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {dashboard.open_auctions.map((auction) => (
                      <div key={auction.auction_id} className="glass-card live-auction-card" style={{ padding: "1.25rem", background: "rgba(10, 15, 30, 0.3)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                          <span className="badge badge-warning">Live Bidding</span>
                          <span>Chit <strong>#{auction.chit_id}</strong></span>
                        </div>
                        <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                          Auction <strong>#{auction.auction_id}</strong> for Installment <strong>#{auction.installment_number}</strong>.
                        </p>
                        <button
                          className="btn btn-primary"
                          style={{ width: "100%", padding: "0.5rem 1rem", fontSize: "0.85rem" }}
                          onClick={() => navigate("/auctions")}
                        >
                          Bid Discount Now
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

      {showKyc && (
        <KYCModal
          onClose={() => setShowKyc(false)}
          onSuccess={handleKycSuccess}
        />
      )}
    </div>
  );
}

export default MemberDashboard;
