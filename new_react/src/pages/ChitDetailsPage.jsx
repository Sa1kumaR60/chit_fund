import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getChitDetails, inviteMember } from "../api/chitApi";

function ChitDetailsPage() {
  const navigate = useNavigate();
  const { chitId } = useParams();
  const role = localStorage.getItem("role");
  const [details, setDetails] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);

  const loadDetails = useCallback(async () => {
    try {
      const data = await getChitDetails(chitId);
      setDetails(data);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error.response?.data?.message || "Unable to retrieve chit group details at this time."
      );
    }
  }, [chitId]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);


  const handleInvite = async (e) => {
    e.preventDefault();
    if (!invitePhone) return;
    setInviteLoading(true);
    try {
      await inviteMember(chitId, invitePhone);
      alert("Invitation sent successfully!");
      setInvitePhone("");
    } catch (error) {
      alert(error.response?.data?.message || "Failed to send invitation.");
    } finally {
      setInviteLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "ACTIVE":
      case "PAID_ON_TIME":
      case "COMPLETED":
        return <span className="badge badge-success">{status}</span>;
      case "DEFAULTER":
      case "UNPAID":
      case "LEFT":
        return <span className="badge badge-danger">{status}</span>;
      case "LATE_PAYMENT":
      case "PENDING":
        return <span className="badge badge-warning">{status}</span>;
      default:
        return <span className="badge badge-primary">{status}</span>;
    }
  };

  return (
    <div>
      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-brand">🪙 Smart Chit Fund</div>
        <div className="nav-links">
          <button className="btn btn-secondary" onClick={() => navigate(role === "ADMIN" ? "/admin" : "/member")}>
            Dashboard
          </button>
        </div>
      </nav>

      <div className="glass-container">
        {/* Header Title */}
        <div className="view-header">
          <div className="view-title-area">
            <h1>Chit Scheme Details</h1>
            <p className="view-subtitle">Examine chit parameters, member logs, payment ledgers, and auction records.</p>
          </div>
          <button className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
        </div>

        {errorMessage && <div className="alert alert-danger">{errorMessage}</div>}

        {details && (
          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            
            {/* Core Chit Info Block */}
            <div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
              <div className="stat-card accent">
                <span className="stat-label">Total Pool Value</span>
                <span className="stat-value" style={{ color: "var(--accent)" }}>
                  ₹{Number(details.chit.chit_value).toLocaleString("en-IN")}
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  Chit #{details.chit.chit_id} ({details.chit.type === "FIXED" ? "Fixed Chit Group" : "Auction Chit Group"})
                </span>
              </div>

              <div className="stat-card primary">
                <span className="stat-label">Monthly Installment</span>
                <span className="stat-value">
                  ₹{Number(details.chit.monthly_installment).toLocaleString("en-IN")}
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  Status: <strong>{details.chit.status}</strong>
                </span>
              </div>

              <div className="stat-card success">
                <span className="stat-label">Duration & Members</span>
                <span className="stat-value" style={{ color: "var(--success)" }}>
                  {details.chit.duration_months} mo
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  Capacity: {details.members.length} / {details.chit.total_members} members
                </span>
              </div>

              <div className="stat-card warning">
                <span className="stat-label">Admin Commission</span>
                <span className="stat-value" style={{ color: "var(--warning)" }}>
                  {(Number(details.chit.admin_commission_rate || 0.05) * 100).toFixed(2)}%
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  Timing: {details.chit.commission_payout_timing || "MONTHLY"}
                </span>
              </div>
            </div>

            {/* Fixed Slots Schedule (if Fixed Chit) */}
            {details.chit.type === "FIXED" && details.slots && details.slots.length > 0 && (
              <div className="glass-card">
                <h2 className="mb-4">📅 Fixed Payout Month Schedule</h2>
                <div className="table-container" style={{ border: "none", margin: 0 }}>
                  <table className="modern-table">
                    <thead>
                      <tr>
                        <th>Assigned Payout Month</th>
                        <th>Claimed Member Name</th>
                        <th>Invited Phone / Email</th>
                        <th>Token</th>
                        <th className="text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.slots.map((slot) => (
                        <tr key={slot.slot_id}>
                          <td style={{ fontWeight: "700", color: "var(--primary-light)" }}>
                            Month #{slot.assigned_month} Payout
                          </td>
                          <td><strong>{slot.claimed_member_name || slot.member_name || "Unclaimed"}</strong></td>
                          <td><code>{slot.invitee_phone || slot.invitee_email || "N/A"}</code></td>
                          <td>
                            {slot.invitation_token ? (
                              <code style={{ fontSize: "0.75rem", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: "4px" }}>
                                {slot.invitation_token.substring(0, 12)}...
                              </code>
                            ) : (
                              "N/A"
                            )}
                          </td>
                          <td className="text-right">{getStatusBadge(slot.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Split Section: Details + Auction preview */}
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "2rem" }}>
              
              {/* Members directory */}
              <div className="glass-card">
                <div className="flex-between mb-4">
                  <h2>Enrolled Members</h2>
                  {/* Join button removed - Members can only join via Admin invite */}
                </div>

                {role === "ADMIN" && (
                  <form onSubmit={handleInvite} style={{ display: "flex", gap: "10px", marginBottom: "1rem" }}>
                    <input
                      type="text"
                      className="modern-input"
                      style={{ flex: 1 }}
                      placeholder="Enter member phone number to invite"
                      value={invitePhone}
                      onChange={(e) => setInvitePhone(e.target.value)}
                      disabled={inviteLoading}
                    />
                    <button type="submit" className="btn btn-primary" disabled={inviteLoading || !invitePhone}>
                      {inviteLoading ? "Inviting..." : "Send Invite"}
                    </button>
                  </form>
                )}

                {details.members.length === 0 ? (
                  <div className="text-center" style={{ padding: "2rem 0" }}>
                    <p style={{ color: "var(--text-muted)" }}>No members have joined this scheme yet.</p>
                  </div>
                ) : (
                  <div className="table-container" style={{ border: "none", margin: 0 }}>
                    <table className="modern-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Phone</th>
                          <th>Auction Winner?</th>
                          <th className="text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.members.map((member) => (
                          <tr key={member.member_id}>
                            <td><strong>{member.name}</strong></td>
                            <td><code>{member.phone}</code></td>
                            <td>
                              {member.has_won_auction ? (
                                <span className="badge badge-success">Won Payout</span>
                              ) : (
                                <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Eligible</span>
                              )}
                            </td>
                            <td className="text-right">{getStatusBadge(member.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Auction preview calculator */}
              <div className="glass-card">
                <h2 className="mb-4">Monthly Pool Estimator</h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1rem" }}>
                  Based on the latest collected monthly pool. Theoretical chit value is not used for payout.
                </p>

                {details.cashflow_preview ? (
                  <div className="calculator-preview">
                    <div className="preview-row">
                      <span>Collected Amount:</span>
                      <strong>₹{Number(details.cashflow_preview.collectedAmount).toLocaleString("en-IN")}</strong>
                    </div>
                    <div className="preview-row">
                      <span>Paid Members:</span>
                      <strong>{details.cashflow_preview.paidMemberCount}</strong>
                    </div>
                    <div className="preview-row">
                      <span>Commission:</span>
                      <strong>₹{Number(details.cashflow_preview.adminCommissionAmount).toLocaleString("en-IN")}</strong>
                    </div>
                    <div className="preview-row">
                      <span>Reserve:</span>
                      <strong>₹{Number(details.cashflow_preview.reserveAmount).toLocaleString("en-IN")}</strong>
                    </div>
                    <div className="preview-row total">
                      <span>Safe Winner Payout at 5% Discount:</span>
                      <span style={{ color: "var(--success)" }}>
                        ₹{Number(details.cashflow_preview.winnerPayout).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="preview-row total" style={{ borderTop: "none", paddingTop: 0 }}>
                      <span>Dividend per paid eligible member:</span>
                      <span style={{ color: "var(--accent)" }}>
                        + ₹{Number(details.cashflow_preview.distributionPerMember).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="alert alert-info">
                    No monthly collection pool exists yet. Member payments will create installment pools automatically.
                  </div>
                )}
              </div>

            </div>

            {/* Split Section 2: Payments + Completed Auctions */}
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "2rem" }}>
              
              {/* Payment ledger */}
              <div className="glass-card">
                <h2 className="mb-4">Installment Payments Ledger</h2>
                {details.payments.length === 0 ? (
                  <div className="text-center" style={{ padding: "2.5rem 0" }}>
                    <p style={{ color: "var(--text-muted)" }}>No payments recorded for this chit group yet.</p>
                  </div>
                ) : (
                  <div className="table-container" style={{ border: "none", margin: 0 }}>
                    <table className="modern-table">
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Installment</th>
                          <th>Amount Paid</th>
                          <th className="text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.payments.map((payment) => (
                          <tr key={payment.payment_id}>
                            <td><strong>{payment.member_name}</strong></td>
                            <td>Month <code>#{payment.installment_number}</code></td>
                            <td>₹{Number(payment.amount_paid).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                            <td className="text-right">{getStatusBadge(payment.payment_status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Auction ledger */}
              <div className="glass-card">
                <h2 className="mb-4">Auction Archives</h2>
                {details.auctions.length === 0 ? (
                  <div className="text-center" style={{ padding: "2.5rem 0" }}>
                    <p style={{ color: "var(--text-muted)" }}>No monthly auctions have occurred yet.</p>
                  </div>
                ) : (
                  <div className="table-container" style={{ border: "none", margin: 0 }}>
                    <table className="modern-table">
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th>Winner Name</th>
                          <th>Discount</th>
                          <th className="text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.auctions.map((auction) => (
                          <tr key={auction.auction_id}>
                            <td>Month <code>#{auction.installment_number}</code></td>
                            <td>
                              {auction.winner_name ? (
                                <strong>{auction.winner_name}</strong>
                              ) : (
                                <span style={{ color: "var(--text-muted)" }}>Undecided</span>
                              )}
                            </td>
                            <td>
                              {auction.winning_discount_percent ? (
                                <span style={{ color: "var(--success)", fontWeight: "600" }}>{auction.winning_discount_percent}%</span>
                              ) : (
                                "N/A"
                              )}
                            </td>
                            <td className="text-right">{getStatusBadge(auction.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>

          </div>
        )}
      </div>
    </div>
  );
}

export default ChitDetailsPage;
