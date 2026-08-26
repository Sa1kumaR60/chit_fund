import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getWalletDetails, addFunds } from "../api/walletApi";

function WalletPage() {
  const navigate = useNavigate();
  const role = localStorage.getItem("role");
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [depositAmount, setDepositAmount] = useState("");
  const [description, setDescription] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const loadWallet = async () => {
    try {
      const data = await getWalletDetails();
      setWallet(data.wallet);
      setTransactions(data.transactions);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error.response?.data?.message || "Failed to retrieve wallet information."
      );
    }
  };

  useEffect(() => {
    loadWallet();
  }, []);

  const handleDeposit = async (e) => {
    e.preventDefault();
    if (!depositAmount || Number(depositAmount) <= 0) {
      alert("Please enter a valid positive amount.");
      return;
    }

    setLoading(true);
    setSuccessMessage("");
    setErrorMessage("");

    try {
      await addFunds({
        amount: Number(depositAmount),
        description: description || "Funds deposited online",
      });
      setSuccessMessage(`Successfully added ₹${Number(depositAmount).toLocaleString("en-IN")} to your wallet!`);
      setDepositAmount("");
      setDescription("");
      await loadWallet();
    } catch (error) {
      setErrorMessage(
        error.response?.data?.message || "Unable to complete mock deposit."
      );
    } finally {
      setLoading(false);
    }
  };

  const setQuickAmount = (amount) => {
    setDepositAmount(amount);
  };

  const getTxBadge = (type) => {
    switch (type) {
      case "DEPOSIT":
      case "AUCTION_WINNING":
      case "DIVIDEND":
        return <span className="badge badge-success">{type.replace("_", " ")}</span>;
      case "INSTALLMENT_PAYMENT":
      case "LATE_FEE":
      case "COMMISSION":
      case "WITHDRAWAL":
        return <span className="badge badge-danger">{type.replace("_", " ")}</span>;
      default:
        return <span className="badge badge-primary">{type}</span>;
    }
  };

  const getTxSignAndClass = (type) => {
    switch (type) {
      case "DEPOSIT":
      case "AUCTION_WINNING":
      case "DIVIDEND":
        return { sign: "+", className: "ledger-amount credit" };
      default:
        return { sign: "-", className: "ledger-amount debit" };
    }
  };

  return (
    <div>
      {/* Top Navbar */}
      <nav className="navbar">
        <div className="nav-brand">🪙 Smart Chit Fund</div>
        <div className="nav-links">
          <div className="nav-user">
            <span>Role: <strong>{role}</strong></span>
          </div>
          <button className="btn btn-secondary" onClick={() => navigate(role === "ADMIN" ? "/admin" : "/member")}>
            Dashboard
          </button>
        </div>
      </nav>

      <div className="glass-container">
        <div className="view-header">
          <div className="view-title-area">
            <h1>My Wallet & Finance</h1>
            <p className="view-subtitle">Add funds, view transaction history, and manage dues from your wallet.</p>
          </div>
        </div>

        {errorMessage && <div className="alert alert-danger">{errorMessage}</div>}
        {successMessage && <div className="alert alert-info">{successMessage}</div>}

        {wallet && (
          <div className="stats-grid" style={{ gridTemplateColumns: "1fr" }}>
            <div className="glass-card wallet-glow-card">
              <div>
                <span className="stat-label">Total Wallet Balance</span>
                <h2 className="stat-value" style={{ fontSize: "3.5rem", margin: "0.5rem 0", color: "var(--success)" }}>
                  ₹{Number(wallet.balance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </h2>
                <p style={{ color: "var(--text-secondary)" }}>
                  All monthly installments are securely processed directly from this wallet.
                </p>
              </div>

              {/* Deposit Panel */}
              <div className="glass-card" style={{ background: "rgba(10, 15, 30, 0.4)", border: "none" }}>
                <h3 className="mb-4">Load Simulated Funds</h3>
                <form onSubmit={handleDeposit}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="deposit-amount">Amount (INR)</label>
                    <input
                      id="deposit-amount"
                      className="form-input"
                      type="number"
                      placeholder="Enter amount (e.g. 5000)"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ display: "flex", flexDirection: "row", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-secondary" style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }} onClick={() => setQuickAmount(2000)}>+ ₹2,000</button>
                    <button type="button" className="btn btn-secondary" style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }} onClick={() => setQuickAmount(5000)}>+ ₹5,000</button>
                    <button type="button" className="btn btn-secondary" style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }} onClick={() => setQuickAmount(10000)}>+ ₹10,000</button>
                  </div>
                  <div className="form-group mt-4">
                    <label className="form-label" htmlFor="deposit-desc">Source/Description (Optional)</label>
                    <input
                      id="deposit-desc"
                      className="form-input"
                      type="text"
                      placeholder="e.g. UPI Deposit, Net Banking"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary mt-4" style={{ width: "100%" }} disabled={loading}>
                    {loading ? "Adding Funds..." : "Add Credits Now"}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        <div className="glass-card mt-8">
          <h2 className="mb-4">Transaction History</h2>
          {transactions.length === 0 ? (
            <div className="text-center" style={{ padding: "3rem 0" }}>
              <p style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>No transactions logged in this wallet yet.</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Tx ID</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Timestamp</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => {
                    const txMeta = getTxSignAndClass(tx.type);
                    return (
                      <tr key={tx.transaction_id}>
                        <td><code>#{tx.transaction_id}</code></td>
                        <td>{getTxBadge(tx.type)}</td>
                        <td>{tx.description || "N/A"}</td>
                        <td>{new Date(tx.created_at).toLocaleString("en-IN")}</td>
                        <td className={txMeta.className} style={{ textAlign: "right" }}>
                          {txMeta.sign} ₹{Number(tx.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default WalletPage;
