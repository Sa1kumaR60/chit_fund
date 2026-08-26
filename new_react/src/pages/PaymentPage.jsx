import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getChits, sendReminder } from "../api/chitApi";
import { getPaymentStatus, makePayment } from "../api/paymentApi";
import { getWalletDetails } from "../api/walletApi";

function PaymentPage() {
  const navigate = useNavigate();
  const role = localStorage.getItem("role");
  const [chits, setChits] = useState([]);
  const [selectedChitId, setSelectedChitId] = useState("");
  const [selectedChit, setSelectedChit] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    chit_id: "",
    installment_number: "",
    payment_date: new Date().toISOString().split("T")[0],
    notes: "",
  });

  const loadChits = useCallback(async () => {
    try {
      const data = await getChits();
      const visibleChits = Array.isArray(data) ? data : [];
      setChits(
        role === "MEMBER"
          ? visibleChits.filter((chit) => chit.membership_status)
          : visibleChits
      );
    } catch (error) {
      console.error(error);
    }
  }, [role]);

  const fetchWallet = useCallback(async () => {
    try {
      const data = await getWalletDetails();
      setWallet(data.wallet);
    } catch (error) {
      console.error("Failed to load wallet", error);
    }
  }, []);

  useEffect(() => {
    loadChits();
    if (role === "MEMBER") {
      fetchWallet();
    }
  }, [fetchWallet, loadChits, role]);

  const loadPaymentStatus = async (chitId) => {
    if (!chitId) {
      setPaymentStatus(null);
      setSelectedChit(null);
      return;
    }

    try {
      const chosen = chits.find((c) => String(c.chit_id) === String(chitId));
      setSelectedChit(chosen || null);
      const data = await getPaymentStatus(chitId);
      setPaymentStatus(data);
    } catch {
      setPaymentStatus(null);
    }
  };

  const handleChitChange = async (event) => {
    const chitId = event.target.value;
    setSelectedChitId(chitId);
    setForm((current) => ({ ...current, chit_id: chitId }));
    await loadPaymentStatus(chitId);
    if (role === "MEMBER") {
      await fetchWallet();
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.installment_number || !form.payment_date) {
      alert("Please enter both the installment number and payment date.");
      return;
    }

    setLoading(true);
    try {
      await makePayment(form);
      alert("Payment recorded successfully!");
      setForm((prev) => ({ ...prev, installment_number: "", notes: "" }));
      await loadPaymentStatus(form.chit_id);
      if (role === "MEMBER") {
        await fetchWallet();
      }
    } catch (error) {
      alert(error.response?.data?.message || "Unable to record payment.");
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "ACTIVE":
      case "PAID_ON_TIME":
      case "COMPLETED":
        return <span className="badge badge-success">{status.replace("_", " ")}</span>;
      case "DEFAULTER":
      case "UNPAID":
        return <span className="badge badge-danger">{status}</span>;
      case "LATE_PAYMENT":
        return <span className="badge badge-warning">{status.replace("_", " ")}</span>;
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
        {/* Header */}
        <div className="view-header">
          <div className="view-title-area">
            <h1>Installment Payments Hub</h1>
            <p className="view-subtitle">Manage member dues, execute installment payments, and view transaction records.</p>
          </div>
          <button className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
        </div>

        {/* Chit selector */}
        <div className="glass-card mb-8">
          <div className="form-group" style={{ maxWidth: "500px", margin: "0 auto" }}>
            <label className="form-label" htmlFor="payment-chit-select" style={{ fontSize: "1rem", textAlign: "center", display: "block", marginBottom: "0.5rem" }}>
              Select Chit Scheme to Examine
            </label>
            <select id="payment-chit-select" className="form-select" value={selectedChitId} onChange={handleChitChange}>
              <option value="">Choose an active chit group</option>
              {chits.map((chit) => (
                <option key={chit.chit_id} value={chit.chit_id}>
                  Chit #{chit.chit_id} — Value: ₹{Number(chit.chit_value).toLocaleString("en-IN")} (Installment: ₹{Number(chit.monthly_installment).toLocaleString("en-IN")})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Split layouts if a chit is selected */}
        {selectedChit && (
          <div style={{ display: "grid", gridTemplateColumns: role === "MEMBER" ? "1.2fr 1fr" : "1fr", gap: "2rem" }}>
            
            {/* Left/Main Column - Forms or Details */}
            <div>
              {role === "MEMBER" && (
                <div className="glass-card">
                  <h2 className="mb-4">Submit Installment Payment</h2>
                  
                  {/* Balance Widget */}
                  {wallet && (
                    <div style={{ background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--panel-border)", padding: "1.25rem", borderRadius: "var(--radius-md)", marginBottom: "1.5rem" }}>
                      <div className="flex-between">
                        <div>
                          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Available Wallet Balance</span>
                          <h3 style={{ color: "var(--success)", fontSize: "1.5rem", fontFamily: "var(--font-display)", fontWeight: "800", marginTop: "0.2rem" }}>
                            ₹{Number(wallet.balance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </h3>
                        </div>
                        <div>
                          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Installment Due</span>
                          <h3 style={{ color: "var(--text-primary)", fontSize: "1.5rem", fontFamily: "var(--font-display)", fontWeight: "800", marginTop: "0.2rem" }}>
                            ₹{Number(selectedChit.monthly_installment).toLocaleString("en-IN")}
                          </h3>
                        </div>
                      </div>

                      {/* Insufficient Funds Warning */}
                      {Number(wallet.balance) < Number(selectedChit.monthly_installment) && (
                        <div className="alert alert-danger" style={{ marginTop: "1rem", marginBottom: 0, flexDirection: "column", gap: "0.5rem" }}>
                          <div>
                            <strong>⚠️ Insufficient Wallet Credits!</strong>
                            <p style={{ fontSize: "0.85rem", marginTop: "0.2rem" }}>
                              Your current wallet balance is ₹{Number(wallet.balance).toLocaleString("en-IN")} which is less than the required ₹{Number(selectedChit.monthly_installment).toLocaleString("en-IN")} monthly installment.
                            </p>
                          </div>
                          <button className="btn btn-primary mt-4" style={{ width: "100%", padding: "0.5rem 1rem", fontSize: "0.85rem" }} onClick={() => navigate("/wallet")}>
                            Add Funds inside Wallet Center
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {wallet && Number(wallet.balance) >= Number(selectedChit.monthly_installment) && (
                    <form onSubmit={handleSubmit}>
                      <div className="grid-2">
                        <div className="form-group">
                          <label className="form-label" htmlFor="installment_number">Installment Month #</label>
                          <input
                            id="installment_number"
                            name="installment_number"
                            type="number"
                            className="form-input"
                            placeholder="e.g. 1"
                            value={form.installment_number}
                            onChange={(event) =>
                              setForm((current) => ({ ...current, installment_number: event.target.value }))
                            }
                            required
                          />
                        </div>

                        <div className="form-group">
                          <label className="form-label" htmlFor="payment_date">Payment Date</label>
                          <input
                            id="payment_date"
                            name="payment_date"
                            type="date"
                            className="form-input"
                            value={form.payment_date}
                            onChange={(event) =>
                              setForm((current) => ({ ...current, payment_date: event.target.value }))
                            }
                            required
                          />
                        </div>
                      </div>

                      <div className="form-group mt-4">
                        <label className="form-label" htmlFor="notes">Remarks/Notes (Optional)</label>
                        <input
                          id="notes"
                          name="notes"
                          type="text"
                          className="form-input"
                          placeholder="e.g. UPI installment"
                          value={form.notes}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, notes: event.target.value }))
                          }
                        />
                      </div>

                      <div className="alert alert-info mt-4" style={{ margin: "1rem 0" }}>
                        <p style={{ fontSize: "0.85rem" }}>
                          ℹ️ Under chit guidelines, payments made after their monthly due dates automatically attract a <strong>2% late fee penalty</strong>.
                        </p>
                      </div>

                      <button type="submit" className="btn btn-success" style={{ width: "100%", marginTop: "1rem" }} disabled={loading}>
                        {loading ? "Processing Payment..." : "Deduct and Pay from Wallet"}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* Admin View - Complete Member List Ledger */}
              {role === "ADMIN" && paymentStatus && (
                <div className="glass-card">
                  <h2 className="mb-4">Member Payments Overview</h2>
                  {paymentStatus.paid_members?.length === 0 && paymentStatus.unpaid_members?.length === 0 ? (
                    <div className="text-center" style={{ padding: "3rem 0" }}>
                      <p style={{ color: "var(--text-muted)" }}>No members have joined this chit group yet.</p>
                    </div>
                  ) : (
                    <>
                      <h3 className="mb-3 mt-4" style={{ color: "var(--danger)" }}>Unpaid Members</h3>
                      {paymentStatus.unpaid_members?.length === 0 ? (
                        <p style={{ color: "var(--success)", fontSize: "0.9rem" }}>No unpaid members!</p>
                      ) : (
                        <div className="table-container" style={{ border: "none", margin: 0, marginBottom: "2rem" }}>
                          <table className="modern-table">
                            <thead>
                              <tr>
                                <th>Member Name</th>
                                <th>Phone</th>
                                <th>Unpaid Months</th>
                                <th>Late Penalty</th>
                                <th className="text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {paymentStatus.unpaid_members?.map((m) => (
                                <tr key={m.member_id}>
                                  <td><strong>{m.name}</strong></td>
                                  <td><code>{m.phone}</code></td>
                                  <td><span className="badge badge-danger">{m.summary.unpaidCount} months</span></td>
                                  <td style={{ color: m.summary.penaltyTotal > 0 ? "var(--warning)" : "var(--text-muted)" }}>
                                    ₹{Number(m.summary.penaltyTotal).toLocaleString("en-IN")}
                                  </td>
                                  <td className="text-right">
                                    <button 
                                      className="btn btn-primary" 
                                      style={{ padding: "0.2rem 0.6rem", fontSize: "0.75rem" }}
                                      onClick={async () => {
                                        try {
                                          await sendReminder(selectedChitId, m.member_id);
                                          alert("Reminder sent!");
                                        } catch {
                                          alert("Failed to send reminder.");
                                        }
                                      }}
                                    >
                                      Send Reminder
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <h3 className="mb-3" style={{ color: "var(--success)" }}>Paid Members</h3>
                      {paymentStatus.paid_members?.length === 0 ? (
                        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No paid members yet.</p>
                      ) : (
                        <div className="table-container" style={{ border: "none", margin: 0 }}>
                          <table className="modern-table">
                            <thead>
                              <tr>
                                <th>Member Name</th>
                                <th>Phone</th>
                                <th>On Time</th>
                                <th>Late Paid</th>
                                <th className="text-right">Dues Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {paymentStatus.paid_members?.map((m) => (
                                <tr key={m.member_id}>
                                  <td><strong>{m.name}</strong></td>
                                  <td><code>{m.phone}</code></td>
                                  <td><span className="badge badge-success">{m.summary.onTimeCount}</span></td>
                                  <td><span className="badge badge-warning">{m.summary.latePaymentCount}</span></td>
                                  <td className="text-right">{getStatusBadge(m.membership_status)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Right Column - Status and logs (only relevant for Member) */}
            {role === "MEMBER" && paymentStatus && (
              <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
                
                {/* Financial Summary */}
                <div className="glass-card">
                  <h2 className="mb-4">Personal Financial Overview</h2>
                  <div className="calculator-preview">
                    <div className="preview-row">
                      <span>On-Time Payments:</span>
                      <strong style={{ color: "var(--success)" }}>{paymentStatus.summary.onTimeCount}</strong>
                    </div>
                    <div className="preview-row">
                      <span>Late Payments:</span>
                      <strong style={{ color: "var(--warning)" }}>{paymentStatus.summary.latePaymentCount}</strong>
                    </div>
                    <div className="preview-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "0.75rem" }}>
                      <span>Unpaid Months:</span>
                      <strong style={{ color: "var(--danger)" }}>{paymentStatus.summary.unpaidCount}</strong>
                    </div>
                    <div className="preview-row total">
                      <span>Immediate Dues:</span>
                      <span style={{ color: "var(--danger)" }}>
                        ₹{Number(paymentStatus.summary.pendingDues).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="preview-row total" style={{ borderTop: "none", paddingTop: 0 }}>
                      <span>Accumulated Penalties:</span>
                      <span style={{ color: "var(--warning)" }}>
                        ₹{Number(paymentStatus.summary.penaltyTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* History list */}
                <div className="glass-card">
                  <h2 className="mb-4">Installment Log</h2>
                  {paymentStatus.summary.payments.length === 0 ? (
                    <div className="text-center" style={{ padding: "2rem 0" }}>
                      <p style={{ color: "var(--text-muted)" }}>No payments recorded yet.</p>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      {paymentStatus.summary.payments.map((p) => (
                        <div key={`${p.installment_number}-${p.paid_at}`} className="glass-card" style={{ padding: "1rem", margin: 0, background: "rgba(255,255,255,0.01)" }}>
                          <div className="flex-between">
                            <strong>Month #{p.installment_number}</strong>
                            {getStatusBadge(p.payment_status)}
                          </div>
                          <div className="flex-between mt-4" style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                            <span>Paid: <strong>₹{Number(p.amount_paid).toLocaleString("en-IN")}</strong></span>
                            <span>{new Date(p.paid_at).toLocaleDateString("en-IN")}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}

export default PaymentPage;
