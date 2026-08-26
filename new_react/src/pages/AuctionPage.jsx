import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getChitDetails, getChits } from "../api/chitApi";
import {
  calculateAuctionResult,
  getAuctionDetails,
  placeBid,
  startAuction,
} from "../api/auctionApi";

function AuctionPage() {
  const navigate = useNavigate();
  const role = localStorage.getItem("role");
  const [chits, setChits] = useState([]);
  const [selectedChit, setSelectedChit] = useState(null);
  const [selectedDetails, setSelectedDetails] = useState(null);
  const [auction, setAuction] = useState(null);
  const [bids, setBids] = useState([]);
  const [discountPercent, setDiscountPercent] = useState("");
  const [installmentNumber, setInstallmentNumber] = useState("");
  const [allowPartialCollection, setAllowPartialCollection] = useState(false);
  const [partialApprovalReason, setPartialApprovalReason] = useState("");
  const [loading, setLoading] = useState(false);

  const selectedPool = useMemo(() => {
    if (!selectedDetails?.collection_pools?.length) {
      return null;
    }

    return (
      selectedDetails.collection_pools.find(
        (pool) => String(pool.installment_number) === String(installmentNumber)
      ) || selectedDetails.collection_pools[0]
    );
  }, [selectedDetails, installmentNumber]);

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

  useEffect(() => {
    loadChits();
  }, [loadChits]);

  const preview = useMemo(() => {
    if (!selectedChit) {
      return null;
    }

    const collectedAmount = auction
      ? Number(auction.pool_amount || 0)
      : Number(selectedPool?.pool_amount || 0);
    const paidMemberCount = auction
      ? Number(auction.paid_member_count || 0)
      : Number(selectedPool?.paid_member_count || 0);
    const adminCommissionRate = Number(selectedChit.admin_commission_rate || 0.05);
    const reserveRate = Number(selectedChit.reserve_rate || 0.02);
    const adminCommission = collectedAmount * adminCommissionRate;
    const reserveAmount = collectedAmount * reserveRate;
    const baseAuctionValue = collectedAmount - adminCommission - reserveAmount;

    const currentDiscount = Number(discountPercent || 5);
    const discountAmount = collectedAmount * (currentDiscount / 100);
    const eligibleDividendMembers = Math.max(0, paidMemberCount - 1);

    return {
      collectedAmount: collectedAmount.toFixed(2),
      paidMemberCount,
      adminCommission: adminCommission.toFixed(2),
      reserveAmount: reserveAmount.toFixed(2),
      baseAuctionValue: baseAuctionValue.toFixed(2),
      estimatedPayout: Math.max(0, baseAuctionValue - discountAmount).toFixed(2),
      distributionPerMember:
        eligibleDividendMembers > 0
          ? Math.floor((discountAmount / eligibleDividendMembers) * 100) / 100
          : 0,
      discountAmount: discountAmount.toFixed(2),
      currentDiscount,
      eligibleDividendMembers,
      maxSafeDiscount: Math.max(0, 100 - adminCommissionRate * 100 - reserveRate * 100),
    };
  }, [selectedChit, selectedPool, auction, discountPercent]);

  const loadAuction = async (auctionId) => {
    try {
      const data = await getAuctionDetails(auctionId);
      setAuction(data.auction);
      setBids(data.bids);
    } catch (error) {
      console.error("Failed to load auction details", error);
    }
  };

  const handleChitSelect = async (event) => {
    const chosen = chits.find((chit) => String(chit.chit_id) === event.target.value);
    setSelectedChit(chosen || null);
    setSelectedDetails(null);
    setAuction(null);
    setBids([]);
    setDiscountPercent("");

    if (chosen) {
      try {
        const details = await getChitDetails(chosen.chit_id);
        setSelectedDetails(details);
        const openAuction = details.auctions.find((entry) => entry.status === "OPEN");

        if (openAuction) {
          await loadAuction(openAuction.auction_id);
        }
      } catch (error) {
        console.error(error);
      }
    }
  };

  const handleStartAuction = async () => {
    if (!installmentNumber || Number(installmentNumber) <= 0) {
      alert("Please enter a valid positive installment month.");
      return;
    }

    setLoading(true);
    try {
      const response = await startAuction({
        chit_id: selectedChit.chit_id,
        installment_number: Number(installmentNumber),
        allow_partial_collection: allowPartialCollection,
        partial_approval_reason: partialApprovalReason,
      });
      await loadAuction(response.auction.auction_id);
      setInstallmentNumber("");
      setAllowPartialCollection(false);
      setPartialApprovalReason("");
      alert("Monthly auction started successfully!");
    } catch (error) {
      alert(error.response?.data?.message || "Unable to start monthly auction.");
    } finally {
      setLoading(false);
    }
  };

  const handlePlaceBid = async () => {
    const bidVal = Number(discountPercent);
    if (!bidVal || bidVal < 0 || bidVal > Number(preview?.maxSafeDiscount || 100)) {
      alert(`Please enter a valid discount percent up to ${Number(preview?.maxSafeDiscount || 100).toFixed(2)}%.`);
      return;
    }

    setLoading(true);
    try {
      await placeBid(auction.auction_id, { discount_percent: bidVal });
      await loadAuction(auction.auction_id);
      alert("Your discount bid has been successfully submitted!");
    } catch (error) {
      alert(error.response?.data?.message || "Unable to place bid.");
    } finally {
      setLoading(false);
    }
  };

  const handleCalculateResult = async () => {
    if (window.confirm("Are you sure you want to close this auction and declare the winner? This will instantly execute payout distributions and wallet ledgers.")) {
      setLoading(true);
      try {
        await calculateAuctionResult(auction.auction_id);
        await loadAuction(auction.auction_id);
        alert("Auction computed and closed! Wallet ledger items have been logged.");
      } catch (error) {
        alert(error.response?.data?.message || "Unable to calculate auction result.");
      } finally {
        setLoading(false);
      }
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "COMPLETED":
        return <span className="badge badge-success">Closed</span>;
      case "OPEN":
        return <span className="badge badge-warning">Live Active</span>;
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
            <h1>Live Bidding & Auctions Arena</h1>
            <p className="view-subtitle">Bid discount percentages dynamically, examine payout estimations, and distribute monthly dividends.</p>
          </div>
          <button className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
        </div>

        {/* Selector Panel */}
        <div className="glass-card mb-8">
          <div className="form-group" style={{ maxWidth: "500px", margin: "0 auto" }}>
            <label className="form-label" htmlFor="auction-chit-select" style={{ fontSize: "1rem", textAlign: "center", display: "block", marginBottom: "0.5rem" }}>
              Select Chit Group for Live Auctions
            </label>
            <select id="auction-chit-select" className="form-select" defaultValue="" onChange={handleChitSelect}>
              <option value="">Choose an active chit group</option>
              {chits.map((chit) => (
                <option key={chit.chit_id} value={chit.chit_id}>
                  Chit #{chit.chit_id} — Value: ₹{Number(chit.chit_value).toLocaleString("en-IN")}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedChit && (
          <div className="auction-grid">
            
            {/* Left Column: live panel calculator & bidding options */}
            <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
              
              {/* Financial calculations preview */}
              <div className="glass-card">
                <h2>Collected Pool Impact Preview</h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
                  Real-time calculation for a {preview?.currentDiscount}% discount bid, using only money collected in this installment.
                </p>

                <div className="calculator-preview">
                  <div className="preview-row">
                    <span>Collected Pool:</span>
                    <strong>₹{Number(preview?.collectedAmount).toLocaleString("en-IN")}</strong>
                  </div>
                  <div className="preview-row">
                    <span>Paid Members:</span>
                    <strong>{preview?.paidMemberCount || 0}</strong>
                  </div>
                  <div className="preview-row">
                    <span>Admin Commission:</span>
                    <strong>₹{Number(preview?.adminCommission).toLocaleString("en-IN")}</strong>
                  </div>
                  <div className="preview-row">
                    <span>Reserve Fund:</span>
                    <strong>₹{Number(preview?.reserveAmount).toLocaleString("en-IN")}</strong>
                  </div>
                  <div className="preview-row">
                    <span>Maximum Auction Base:</span>
                    <strong>₹{Number(preview?.baseAuctionValue).toLocaleString("en-IN")}</strong>
                  </div>
                  <div className="preview-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "0.75rem" }}>
                    <span>Selected Bid Discount ({preview?.currentDiscount}%):</span>
                    <strong style={{ color: "var(--warning)" }}>
                      - ₹{Number(preview?.discountAmount).toLocaleString("en-IN")}
                    </strong>
                  </div>
                  <div className="preview-row total">
                    <span>Estimated Winner Payout:</span>
                    <span style={{ color: "var(--success)" }}>
                      ₹{Number(preview?.estimatedPayout).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="preview-row total" style={{ borderTop: "none", paddingTop: 0 }}>
                    <span>Dividend per eligible paid member:</span>
                    <span style={{ color: "var(--accent)" }}>
                      + ₹{Number(preview?.distributionPerMember).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Bidding Panel */}
              {auction && (
                <div className="glass-card live-auction-card">
                  <div className="flex-between mb-4">
                    <h2>Live Active Bidding Arena</h2>
                    {getStatusBadge(auction.status)}
                  </div>
                  
                  <div style={{ background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--panel-border)", padding: "1.25rem", borderRadius: "var(--radius-md)", marginBottom: "1.5rem" }}>
                    <div className="grid-2">
                      <div>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Auction ID</span>
                        <p style={{ fontWeight: "700", fontSize: "1.1rem" }}>#{auction.auction_id}</p>
                      </div>
                      <div>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Installment Month</span>
                        <p style={{ fontWeight: "700", fontSize: "1.1rem" }}>Month #{auction.installment_number}</p>
                      </div>
                      <div>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Locked Pool</span>
                        <p style={{ fontWeight: "700", fontSize: "1.1rem" }}>₹{Number(auction.pool_amount || 0).toLocaleString("en-IN")}</p>
                      </div>
                      <div>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Paid Members</span>
                        <p style={{ fontWeight: "700", fontSize: "1.1rem" }}>{auction.paid_member_count || 0}</p>
                      </div>
                    </div>
                  </div>

                  {/* Member bidding controls */}
                  {role === "MEMBER" && auction.status === "OPEN" && (
                    <form onSubmit={(e) => { e.preventDefault(); handlePlaceBid(); }}>
                      <div className="form-group">
                        <label className="form-label" htmlFor="discount-slider">
                          Select Bid Discount Percent: <strong style={{ color: "var(--warning)", fontSize: "1.2rem" }}>{discountPercent || 5}%</strong>
                        </label>
                        <input
                          id="discount-slider"
                          type="range"
                          min="1"
                          max={preview?.maxSafeDiscount || 90}
                          step="1"
                          style={{ accentColor: "var(--primary)", width: "100%", height: "8px", borderRadius: "4px", background: "rgba(255,255,255,0.1)", outline: "none" }}
                          value={discountPercent || 5}
                          onChange={(event) => setDiscountPercent(event.target.value)}
                        />
                        <div className="flex-between" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                          <span>1% (Max Payout)</span>
                          <span>{Number(preview?.maxSafeDiscount || 90).toFixed(0)}% (Min Safe Payout)</span>
                        </div>
                      </div>

                      <div className="form-group mt-4">
                        <label className="form-label" htmlFor="discount-input">Or Enter Precise Percentage</label>
                        <input
                          id="discount-input"
                          className="form-input"
                          type="number"
                          placeholder="e.g. 8.5"
                          value={discountPercent}
                          onChange={(event) => setDiscountPercent(event.target.value)}
                          max={preview?.maxSafeDiscount || 90}
                        />
                      </div>

                      <div className="alert alert-info mt-4" style={{ margin: "1rem 0" }}>
                        <p style={{ fontSize: "0.8rem" }}>
                          <strong>Cash-flow rule:</strong> Highest discount wins, payout never exceeds the collected pool after commission, reserve, and discount. Dividends go only to paid eligible members, excluding the winner.
                        </p>
                      </div>

                      <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "1rem" }} disabled={loading}>
                        {loading ? "Submitting Bid..." : "Lock and Place Bid"}
                      </button>
                    </form>
                  )}

                  {/* Admin result closing controls */}
                  {role === "ADMIN" && auction.status === "OPEN" && (
                    <div>
                      <div className="alert alert-warning" style={{ marginBottom: "1.5rem" }}>
                        <p style={{ fontSize: "0.85rem" }}>
                          <strong>Organizer Warning:</strong> Closing the auction resolves all bids, selects the highest discount bidder, and writes payout, commission, reserve, and dividend ledger entries.
                        </p>
                      </div>
                      <button
                        className="btn btn-success"
                        style={{ width: "100%" }}
                        onClick={handleCalculateResult}
                        disabled={loading}
                      >
                        {loading ? "Computing ledgers..." : "Close Auction & Distribute Funds"}
                      </button>
                    </div>
                  )}

                  {auction.status === "COMPLETED" && (
                    <div className="alert alert-info" style={{ margin: 0, padding: "1.25rem" }}>
                      <h3 style={{ color: "var(--success)", fontSize: "1.1rem", marginBottom: "0.5rem" }}>✓ Auction Closed Successfully</h3>
                      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                        This monthly auction has closed. The winnings and dividends have been credited to everyone's wallet balance.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Start auction panel (Admins only) */}
              {role === "ADMIN" && !auction && (
                <div className="glass-card">
                  <h2 className="mb-4">Launch New Installment Auction</h2>
                  <div className="form-group">
                    <label className="form-label" htmlFor="installment-input">Installment Month #</label>
                    <input
                      id="installment-input"
                      className="form-input"
                      type="number"
                      placeholder="e.g. 1"
                      value={installmentNumber}
                      onChange={(event) => setInstallmentNumber(event.target.value)}
                    />
                  </div>
                  <div className="calculator-preview">
                    <div className="preview-row">
                      <span>Pool Status</span>
                      <strong>{selectedPool?.status || "No payments yet"}</strong>
                    </div>
                    <div className="preview-row">
                      <span>Collected</span>
                      <strong>₹{Number(selectedPool?.pool_amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>
                    </div>
                    <div className="preview-row">
                      <span>Paid Members</span>
                      <strong>{selectedPool?.paid_member_count || 0}</strong>
                    </div>
                    <div className="preview-row">
                      <span>Minimum Collection</span>
                      <strong>₹{Number(selectedChit.minimum_collection_required || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>
                    </div>
                  </div>
                  <label className="flex-gap-2" style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginTop: "1rem" }}>
                    <input
                      type="checkbox"
                      checked={allowPartialCollection}
                      onChange={(event) => setAllowPartialCollection(event.target.checked)}
                    />
                    Allow manual partial collection approval
                  </label>
                  {allowPartialCollection && (
                    <div className="form-group mt-4">
                      <label className="form-label" htmlFor="partial-reason">Approval Reason</label>
                      <input
                        id="partial-reason"
                        className="form-input"
                        type="text"
                        placeholder="e.g. admin-approved emergency payout"
                        value={partialApprovalReason}
                        onChange={(event) => setPartialApprovalReason(event.target.value)}
                      />
                    </div>
                  )}
                  <button
                    className="btn btn-primary mt-4"
                    style={{ width: "100%" }}
                    onClick={handleStartAuction}
                    disabled={loading}
                  >
                    {loading ? "Starting..." : "Start Live Monthly Auction"}
                  </button>
                </div>
              )}

            </div>

            {/* Right Column: Dynamic live bids log */}
            <div className="glass-card">
              <h2 className="mb-4">Bids Queue Registry</h2>
              {!auction ? (
                <div className="text-center" style={{ padding: "4rem 0" }}>
                  <p style={{ color: "var(--text-muted)" }}>Select a chit group or start an auction to view bidding logs.</p>
                </div>
              ) : bids.length === 0 ? (
                <div className="text-center" style={{ padding: "4rem 0" }}>
                  <span className="badge badge-warning" style={{ marginBottom: "1rem" }}>Waiting for bids</span>
                  <p style={{ color: "var(--text-muted)" }}>No members have submitted bids for this monthly installment yet.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {bids.map((bid) => (
                    <div
                      key={bid.bid_id}
                      className={`bid-item ${bid.is_winner ? 'winner' : ''}`}
                      style={{ borderLeft: bid.is_winner ? "4px solid var(--success)" : "1px solid var(--panel-border)" }}
                    >
                      <div>
                        <div className="flex-gap-2">
                          <strong>{bid.member_name}</strong>
                          {bid.is_winner && <span className="badge badge-success">Winner</span>}
                        </div>
                        <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
                          Est. Payout: <strong>₹{Number(bid.estimated_payout).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>
                        </p>
                        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          Dividend per member: <strong>+ ₹{Number(bid.distribution_per_member).toLocaleString("en-IN")}</strong>
                        </p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: "1.5rem", fontFamily: "var(--font-display)", fontWeight: "800", color: bid.is_winner ? "var(--success)" : "var(--text-primary)" }}>
                          {bid.discount_percent}%
                        </span>
                        <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>Discount Bid</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

export default AuctionPage;
