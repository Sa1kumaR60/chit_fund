import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  createWizardChit,
  saveMonthlyRules,
  configureMemberSlots,
  getFinancialSimulationPreview,
  activateChit,
} from "../api/chitApi";

function CreateChit() {
  const navigate = useNavigate();

  // Wizard Step Control (1 to 5)
  const [currentStep, setCurrentStep] = useState(1);
  const [createdChitId, setCreatedChitId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  // Step 1 & 2: Basic Chit Form
  const [form, setForm] = useState({
    group_name: "",
    type: "FIXED", // FIXED or AUCTION
    chit_value: "100000",
    start_date: new Date().toISOString().split("T")[0],
    duration_months: "10",
    total_members: "10",
    monthly_due_date: 5,
    grace_period_days: 5,
    description: "",
    admin_commission_rate: 0.05,
    late_fee_rate: 0.02,
    // Auction specific
    auction_method: "HIGHEST_DISCOUNT",
    max_discount_allowed: "30000",
    min_bid_amount: "5000",
    auction_start_time: "10:00",
    auction_end_time: "18:00",
    commission_payout_timing: "MONTHLY",
  });

  // Step 3: Month-wise Rules State (for Auction Chits)
  const [monthlyRules, setMonthlyRules] = useState([]);

  // Step 4: Fixed Slots (Month 1..N) or Auction Invites
  const [slots, setSlots] = useState([]);
  const [auctionInvites, setAuctionInvites] = useState([]);

  // Step 5: Simulation Data
  const [simulationData, setSimulationData] = useState(null);

  // Derive initial rules & slots when total_members or duration_months changes
  const initRulesAndSlots = (duration, members, chitVal, type) => {
    const dur = Number(duration) || 10;
    const mem = Number(members) || 10;
    const val = Number(chitVal) || 100000;
    const baseInst = val / dur;

    // Monthly rules
    const rules = [];
    for (let m = 1; m <= dur; m++) {
      rules.push({
        month_number: m,
        fixed_installment_amount: baseInst.toFixed(2),
        winner_pays_amount: baseInst.toFixed(2),
        non_winner_pays_amount: (baseInst * 0.9).toFixed(2),
        min_discount: (val * 0.05).toFixed(2),
        max_discount: (val * 0.3).toFixed(2),
      });
    }
    setMonthlyRules(rules);

    // Slots
    const newSlots = [];
    for (let m = 1; m <= mem; m++) {
      newSlots.push({
        assigned_month: m,
        member_name: "",
        invitee_phone: "",
        invitee_email: "",
      });
    }
    setSlots(newSlots);

    const newInvites = [];
    for (let i = 1; i <= mem; i++) {
      newInvites.push({
        member_name: "",
        invitee_phone: "",
        invitee_email: "",
      });
    }
    setAuctionInvites(newInvites);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => {
      const updated = { ...prev, [name]: value };
      if (name === "duration_months" || name === "total_members" || name === "chit_value" || name === "type") {
        initRulesAndSlots(
          name === "duration_months" ? value : updated.duration_months,
          name === "total_members" ? value : updated.total_members,
          name === "chit_value" ? value : updated.chit_value,
          name === "type" ? value : updated.type
        );
      }
      return updated;
    });
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  // --- Step 1 Navigation ---
  const handleSelectType = (selectedType) => {
    setForm((prev) => ({ ...prev, type: selectedType }));
    initRulesAndSlots(form.duration_months, form.total_members, form.chit_value, selectedType);
    setCurrentStep(2);
  };

  // --- Step 2 Validation & Creation ---
  const handleStep2Submit = async (e) => {
    e.preventDefault();
    const newErrors = {};
    if (!form.group_name.trim()) newErrors.group_name = "Group Name is required";
    if (!form.chit_value || Number(form.chit_value) <= 0) newErrors.chit_value = "Valid Chit Value is required";
    if (!form.duration_months || Number(form.duration_months) <= 0) newErrors.duration_months = "Duration is required";
    if (!form.total_members || Number(form.total_members) <= 0) newErrors.total_members = "Total Members required";
    if (!form.start_date) newErrors.start_date = "Start Date is required";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    try {
      const res = await createWizardChit(form);
      setCreatedChitId(res.chit_id);
      setCurrentStep(3);
    } catch (err) {
      alert(err.response?.data?.message || "Failed to create basic chit draft.");
    } finally {
      setLoading(false);
    }
  };

  // --- Step 3 Rules Save ---
  const handleStep3Submit = async (e) => {
    e.preventDefault();
    if (!createdChitId) return;

    setLoading(true);
    try {
      await saveMonthlyRules(createdChitId, monthlyRules);
      setCurrentStep(4);
    } catch (err) {
      alert(err.response?.data?.message || "Failed to save monthly rules.");
    } finally {
      setLoading(false);
    }
  };

  const handleRuleChange = (index, field, value) => {
    setMonthlyRules((prev) => {
      const updated = [...prev];
      updated[index][field] = value;
      return updated;
    });
  };

  // --- Step 4 Slots / Invites Save ---
  const handleSlotChange = (index, field, value) => {
    setSlots((prev) => {
      const updated = [...prev];
      updated[index][field] = value;
      return updated;
    });
  };

  const handleAuctionInviteChange = (index, field, value) => {
    setAuctionInvites((prev) => {
      const updated = [...prev];
      updated[index][field] = value;
      return updated;
    });
  };

  const handleStep4Submit = async (e) => {
    e.preventDefault();
    if (!createdChitId) return;

    setLoading(true);
    try {
      const payload = form.type === "FIXED" ? { slots } : { invitees: auctionInvites };
      await configureMemberSlots(createdChitId, payload);

      // Fetch Step 5 simulation preview
      const simRes = await getFinancialSimulationPreview(createdChitId);
      setSimulationData(simRes.simulation);
      setCurrentStep(5);
    } catch (err) {
      alert(err.response?.data?.message || "Failed to save member configuration.");
    } finally {
      setLoading(false);
    }
  };

  // --- Step 5 Final Activation ---
  const handleActivateChit = async () => {
    if (!createdChitId) return;
    setLoading(true);
    try {
      await activateChit(createdChitId);
      alert("🎉 Chit Group Activated Successfully!");
      navigate("/admin");
    } catch (err) {
      alert(err.response?.data?.message || "Failed to activate chit group.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Top Navbar */}
      <nav className="navbar">
        <div className="nav-brand">🪙 Smart Chit Fund Wizard</div>
        <div className="nav-links">
          <button className="btn btn-secondary" onClick={() => navigate("/admin")}>
            Exit Wizard
          </button>
        </div>
      </nav>

      <div className="glass-container" style={{ maxWidth: "900px", margin: "2rem auto" }}>
        {/* Step Indicator Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "2rem",
            background: "rgba(255,255,255,0.03)",
            padding: "1rem",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--panel-border)",
          }}
        >
          {[
            "1. Select Type",
            "2. Basic Information",
            "3. Rule Engine",
            "4. Member Schedule",
            "5. Simulation & Approval",
          ].map((label, idx) => {
            const stepNum = idx + 1;
            const active = currentStep === stepNum;
            const completed = currentStep > stepNum;
            return (
              <div
                key={label}
                style={{
                  textAlign: "center",
                  flex: 1,
                  color: active
                    ? "var(--primary-light)"
                    : completed
                    ? "var(--success)"
                    : "var(--text-secondary)",
                  fontWeight: active ? "700" : "500",
                  fontSize: "0.85rem",
                  borderBottom: active ? "2px solid var(--primary-light)" : "2px solid transparent",
                  paddingBottom: "0.5rem",
                }}
              >
                {completed ? "✓ " : `${stepNum}. `} {label.split(". ")[1]}
              </div>
            );
          })}
        </div>

        {/* STEP 1: Select Chit Type */}
        {currentStep === 1 && (
          <div className="glass-card">
            <h1 className="form-title" style={{ textAlign: "center", marginBottom: "0.5rem" }}>
              Step 1: Select Chit Type
            </h1>
            <p style={{ textAlign: "center", color: "var(--text-secondary)", marginBottom: "2rem" }}>
              Choose the operational model for this Chit Group. The remaining screens will adjust dynamically.
            </p>

            <div className="grid-2" style={{ gap: "1.5rem" }}>
              <div
                className="glass-card card-interactive"
                style={{
                  border: form.type === "FIXED" ? "2px solid var(--primary-light)" : "1px solid var(--panel-border)",
                  cursor: "pointer",
                  padding: "1.5rem",
                  textAlign: "center",
                }}
                onClick={() => handleSelectType("FIXED")}
              >
                <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>📅</div>
                <h3 style={{ fontSize: "1.25rem", marginBottom: "0.5rem", color: "var(--primary-light)" }}>
                  Fixed Chit Group
                </h3>
                <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                  Every member is pre-assigned a specific payout month before start. Installments and payout schedule remain fixed throughout.
                </p>
                <button className="btn btn-primary" style={{ marginTop: "1rem", width: "100%" }}>
                  Select Fixed Chit
                </button>
              </div>

              <div
                className="glass-card card-interactive"
                style={{
                  border: form.type === "AUCTION" ? "2px solid var(--primary-light)" : "1px solid var(--panel-border)",
                  cursor: "pointer",
                  padding: "1.5rem",
                  textAlign: "center",
                }}
                onClick={() => handleSelectType("AUCTION")}
              >
                <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>⚖️</div>
                <h3 style={{ fontSize: "1.25rem", marginBottom: "0.5rem", color: "var(--primary-light)" }}>
                  Auction Chit Group
                </h3>
                <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                  Monthly live bidding determines the winner. Installment dividends are calculated dynamically using the rule engine after each auction.
                </p>
                <button className="btn btn-primary" style={{ marginTop: "1rem", width: "100%" }}>
                  Select Auction Chit
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Basic Information */}
        {currentStep === 2 && (
          <div className="glass-card">
            <h2 className="form-title" style={{ textAlign: "center", marginBottom: "0.5rem" }}>
              Step 2: Basic Chit Information ({form.type === "FIXED" ? "Fixed Chit" : "Auction Chit"})
            </h2>
            <p style={{ textAlign: "center", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
              Configure fundamental parameters. The chit will remain in Draft status until completed.
            </p>

            <form onSubmit={handleStep2Submit}>
              <div className="form-group">
                <label className="form-label">Chit Group Name</label>
                <input
                  name="group_name"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Executive Savings Circle 2026"
                  value={form.group_name}
                  onChange={handleFormChange}
                />
                {errors.group_name && <span style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{errors.group_name}</span>}
              </div>

              <div className="grid-3" style={{ gap: "1rem" }}>
                <div className="form-group">
                  <label className="form-label">Total Chit Value (₹)</label>
                  <input
                    name="chit_value"
                    type="number"
                    className="form-input"
                    value={form.chit_value}
                    onChange={handleFormChange}
                  />
                  {errors.chit_value && <span style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{errors.chit_value}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Duration (Months)</label>
                  <input
                    name="duration_months"
                    type="number"
                    className="form-input"
                    value={form.duration_months}
                    onChange={handleFormChange}
                  />
                  {errors.duration_months && <span style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{errors.duration_months}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Total Members</label>
                  <input
                    name="total_members"
                    type="number"
                    className="form-input"
                    value={form.total_members}
                    onChange={handleFormChange}
                  />
                  {errors.total_members && <span style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{errors.total_members}</span>}
                </div>
              </div>

              <div className="grid-3" style={{ gap: "1rem", marginTop: "1rem" }}>
                <div className="form-group">
                  <label className="form-label">Start Date</label>
                  <input
                    name="start_date"
                    type="date"
                    className="form-input"
                    value={form.start_date}
                    onChange={handleFormChange}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Monthly Due Date (1-28)</label>
                  <input
                    name="monthly_due_date"
                    type="number"
                    min="1" max="28"
                    className="form-input"
                    value={form.monthly_due_date}
                    onChange={handleFormChange}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Grace Period (Days)</label>
                  <input
                    name="grace_period_days"
                    type="number"
                    min="0" max="15"
                    className="form-input"
                    value={form.grace_period_days}
                    onChange={handleFormChange}
                  />
                </div>
              </div>

              {form.type === "AUCTION" && (
                <div style={{ marginTop: "1.5rem", padding: "1rem", background: "rgba(255,255,255,0.02)", border: "1px solid var(--panel-border)", borderRadius: "var(--radius-md)" }}>
                  <h3 style={{ fontSize: "1rem", marginBottom: "1rem", color: "var(--primary-light)" }}>Auction Rules Configuration</h3>
                  <div className="grid-2" style={{ gap: "1rem" }}>
                    <div className="form-group">
                      <label className="form-label">Auction Bidding Method</label>
                      <select name="auction_method" className="form-input" value={form.auction_method} onChange={handleFormChange}>
                        <option value="HIGHEST_DISCOUNT">Highest Discount Wins</option>
                        <option value="LOWEST_BID">Lowest Bid Wins</option>
                        <option value="MANUAL_WINNER">Manual Winner Selection</option>
                        <option value="HYBRID">Hybrid Method</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Commission Collection Timing</label>
                      <select name="commission_payout_timing" className="form-input" value={form.commission_payout_timing} onChange={handleFormChange}>
                        <option value="MONTHLY">Deduct Monthly (Recommended)</option>
                        <option value="ON_PAYOUT">Deduct at Payout Time</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid-4" style={{ gap: "1rem", marginTop: "1rem" }}>
                    <div className="form-group">
                      <label className="form-label">Max Discount (₹)</label>
                      <input name="max_discount_allowed" type="number" className="form-input" value={form.max_discount_allowed} onChange={handleFormChange} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Min Bid (₹)</label>
                      <input name="min_bid_amount" type="number" className="form-input" value={form.min_bid_amount} onChange={handleFormChange} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Auction Start Time</label>
                      <input name="auction_start_time" type="time" className="form-input" value={form.auction_start_time} onChange={handleFormChange} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Auction End Time</label>
                      <input name="auction_end_time" type="time" className="form-input" value={form.auction_end_time} onChange={handleFormChange} />
                    </div>
                  </div>
                </div>
              )}

              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label className="form-label">Description / Special Terms (Optional)</label>
                <textarea name="description" className="form-input" rows="2" value={form.description} onChange={handleFormChange} />
              </div>

              <div className="btn-group" style={{ marginTop: "1.5rem" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setCurrentStep(1)}>
                  Back
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? "Saving Draft..." : "Proceed to Rule Engine →"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* STEP 3: Configure Financial Rules Engine */}
        {currentStep === 3 && (
          <div className="glass-card">
            <h2 className="form-title" style={{ textAlign: "center", marginBottom: "0.5rem" }}>
              Step 3: Financial & Rule Engine Configuration
            </h2>
            <p style={{ textAlign: "center", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
              {form.type === "FIXED"
                ? "Review the fixed monthly installment schedule."
                : "Configure month-wise winner/non-winner installment parameters for relational querying."}
            </p>

            <form onSubmit={handleStep3Submit}>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Month #</th>
                      {form.type === "FIXED" ? (
                        <>
                          <th>Monthly Installment (₹)</th>
                          <th>Admin Commission (₹)</th>
                          <th>Member Payout (₹)</th>
                        </>
                      ) : (
                        <>
                          <th>Min Discount (₹)</th>
                          <th>Max Discount (₹)</th>
                          <th>Winner Pays (₹)</th>
                          <th>Non-Winner Pays (₹)</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyRules.map((rule, idx) => (
                      <tr key={rule.month_number}>
                        <td>Month {rule.month_number}</td>
                        {form.type === "FIXED" ? (
                          <>
                            <td>₹{rule.fixed_installment_amount}</td>
                            <td>₹{((form.chit_value * form.admin_commission_rate) / form.duration_months).toFixed(2)}</td>
                            <td>₹{(form.chit_value * (1 - form.admin_commission_rate)).toFixed(2)}</td>
                          </>
                        ) : (
                          <>
                            <td>
                              <input
                                type="number"
                                className="form-input"
                                style={{ padding: "0.25rem 0.5rem", width: "100px" }}
                                value={rule.min_discount}
                                onChange={(e) => handleRuleChange(idx, "min_discount", e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                className="form-input"
                                style={{ padding: "0.25rem 0.5rem", width: "100px" }}
                                value={rule.max_discount}
                                onChange={(e) => handleRuleChange(idx, "max_discount", e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                className="form-input"
                                style={{ padding: "0.25rem 0.5rem", width: "110px" }}
                                value={rule.winner_pays_amount}
                                onChange={(e) => handleRuleChange(idx, "winner_pays_amount", e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                className="form-input"
                                style={{ padding: "0.25rem 0.5rem", width: "110px" }}
                                value={rule.non_winner_pays_amount}
                                onChange={(e) => handleRuleChange(idx, "non_winner_pays_amount", e.target.value)}
                              />
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="btn-group" style={{ marginTop: "1.5rem" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setCurrentStep(2)}>
                  Back
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? "Saving Rules..." : "Proceed to Member Schedule →"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* STEP 4: Configure Member Schedule & Invitations */}
        {currentStep === 4 && (
          <div className="glass-card">
            <h2 className="form-title" style={{ textAlign: "center", marginBottom: "0.5rem" }}>
              Step 4: Configure Member Schedule & Invites
            </h2>
            <p style={{ textAlign: "center", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
              {form.type === "FIXED"
                ? "Assign each member to a specific payout month slot (1..N). Invites will be generated."
                : "Enter member invitee details to invite participants to this Auction Chit."}
            </p>

            <form onSubmit={handleStep4Submit}>
              <div style={{ overflowX: "auto" }}>
                {form.type === "FIXED" ? (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Payout Month</th>
                        <th>Member Name</th>
                        <th>Phone Number (Required for Invite)</th>
                        <th>Email (Optional)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slots.map((slot, idx) => (
                        <tr key={slot.assigned_month}>
                          <td style={{ fontWeight: "700", color: "var(--primary-light)" }}>
                            Month {slot.assigned_month} Payout
                          </td>
                          <td>
                            <input
                              type="text"
                              className="form-input"
                              placeholder="e.g. Rahul Sharma"
                              value={slot.member_name}
                              onChange={(e) => handleSlotChange(idx, "member_name", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="form-input"
                              placeholder="9876543210"
                              value={slot.invitee_phone}
                              onChange={(e) => handleSlotChange(idx, "invitee_phone", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="email"
                              className="form-input"
                              placeholder="rahul@gmail.com"
                              value={slot.invitee_email}
                              onChange={(e) => handleSlotChange(idx, "invitee_email", e.target.value)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Invitee #</th>
                        <th>Member Name</th>
                        <th>Phone Number</th>
                        <th>Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auctionInvites.map((inv, idx) => (
                        <tr key={idx}>
                          <td>Member {idx + 1}</td>
                          <td>
                            <input
                              type="text"
                              className="form-input"
                              placeholder="Member Name"
                              value={inv.member_name}
                              onChange={(e) => handleAuctionInviteChange(idx, "member_name", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="form-input"
                              placeholder="Phone"
                              value={inv.invitee_phone}
                              onChange={(e) => handleAuctionInviteChange(idx, "invitee_phone", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="email"
                              className="form-input"
                              placeholder="Email"
                              value={inv.invitee_email}
                              onChange={(e) => handleAuctionInviteChange(idx, "invitee_email", e.target.value)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="btn-group" style={{ marginTop: "1.5rem" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setCurrentStep(3)}>
                  Back
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? "Generating Invites..." : "Generate Simulation & Preview →"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* STEP 5: Financial Simulation & Final Approval */}
        {currentStep === 5 && simulationData && (
          <div className="glass-card">
            <h2 className="form-title" style={{ textAlign: "center", marginBottom: "0.5rem" }}>
              Step 5: Pre-Activation Financial Simulation
            </h2>
            <p style={{ textAlign: "center", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
              Review the projected month-by-month cashflow, collections, admin revenue, and payout distribution before activating.
            </p>

            <div className="grid-3" style={{ gap: "1rem", marginBottom: "1.5rem" }}>
              <div className="glass-card text-center" style={{ padding: "1rem" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Total Chit Value</span>
                <h3 style={{ color: "var(--primary-light)", fontSize: "1.3rem" }}>
                  ₹{Number(simulationData.chitValue).toLocaleString("en-IN")}
                </h3>
              </div>

              <div className="glass-card text-center" style={{ padding: "1rem" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Expected Admin Revenue</span>
                <h3 style={{ color: "var(--success)", fontSize: "1.3rem" }}>
                  ₹{Number(simulationData.totalAdminCommission).toLocaleString("en-IN")}
                </h3>
              </div>

              <div className="glass-card text-center" style={{ padding: "1rem" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Total Member Collections</span>
                <h3 style={{ color: "var(--warning)", fontSize: "1.3rem" }}>
                  ₹{Number(simulationData.totalExpectedCollections).toLocaleString("en-IN")}
                </h3>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Expected Collection</th>
                    <th>Admin Commission</th>
                    <th>Winner Net Payout</th>
                    {simulationData.type === "AUCTION" && <th>Est. Dividend / Member</th>}
                  </tr>
                </thead>
                <tbody>
                  {simulationData.monthProjections.map((p) => (
                    <tr key={p.monthNumber}>
                      <td>Month {p.monthNumber}</td>
                      <td>₹{p.expectedCollection.toLocaleString("en-IN")}</td>
                      <td>₹{p.adminCommission.toLocaleString("en-IN")}</td>
                      <td style={{ fontWeight: "700", color: "var(--success)" }}>
                        ₹{p.payoutAmount.toLocaleString("en-IN")}
                      </td>
                      {simulationData.type === "AUCTION" && (
                        <td style={{ color: "var(--warning)" }}>₹{p.estimatedDividend.toLocaleString("en-IN")}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="btn-group" style={{ marginTop: "2rem" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setCurrentStep(4)}>
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 2, background: "var(--success)", borderColor: "var(--success)" }}
                disabled={loading}
                onClick={handleActivateChit}
              >
                {loading ? "Activating..." : "🚀 Approve Simulation & Activate Chit Group"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CreateChit;
