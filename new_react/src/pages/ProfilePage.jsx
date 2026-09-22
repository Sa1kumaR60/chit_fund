import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getProfile,
  updateProfile,
  uploadAvatar,
  deleteAvatar,
  submitKyc,
  getKycDetails,
  getNotificationPreferences,
  updateNotificationPreferences,
  getAdminSettlementAccount,
  updateAdminSettlementAccount,
  getAdminChitDefaults,
  updateAdminChitDefaults,
  getPendingKycQueue,
  reviewMemberKyc,
  getActiveSessions,
  logoutSession,
  logoutOtherDevices,
  deactivateAccount,
} from "../api/profileApi";

function ProfilePage() {
  const navigate = useNavigate();
  const [userProfile, setUserProfile] = useState(null);
  const [kycData, setKycData] = useState(null);
  const [kycHistory, setKycHistory] = useState([]);
  const [walletData, setWalletData] = useState(null);
  const [activeTab, setActiveTab] = useState("personal");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: "", text: "" });

  // Form States
  const [name, setName] = useState("");
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [panNumber, setPanNumber] = useState("");
  const [aadhaarNumber, setAadhaarNumber] = useState("");
  const [idDocumentBase64, setIdDocumentBase64] = useState("");
  const [docFileName, setDocFileName] = useState("");

  // Notification preferences
  const [notifPrefs, setNotifPrefs] = useState({
    in_app_enabled: 1,
    email_enabled: 1,
    sms_enabled: 1,
    push_enabled: 0,
  });

  // Admin Settlement Account State
  const [settlementAcc, setSettlementAcc] = useState({
    bank_name: "",
    account_holder_name: "",
    account_number: "",
    account_number_masked: "",
    ifsc_code: "",
    upi_id: "",
  });

  // Admin Chit Defaults State
  const [chitDefaults, setChitDefaults] = useState({
    auto_start_preference: 0,
    admin_approval_required: 1,
    allow_member_leave_before_start: 1,
    default_grace_period_days: 5,
    default_late_fee_rate: 0.02,
  });

  // Admin KYC Review Queue
  const [kycQueue, setKycQueue] = useState([]);
  const [selectedKycReview, setSelectedKycReview] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");

  // Sessions State
  const [sessions, setSessions] = useState([]);

  // Deactivation state
  const [deactivateReason, setDeactivateReason] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getProfile();
      setUserProfile(data.user);
      setName(data.user.name);
      setWalletData(data.wallet);

      const kycRes = await getKycDetails();
      setKycData(kycRes.kyc);
      setKycHistory(kycRes.history || []);

      const prefs = await getNotificationPreferences();
      if (prefs) setNotifPrefs(prefs);

      const sess = await getActiveSessions();
      if (sess) setSessions(sess);

      if (data.user.role === "ADMIN") {
        const settle = await getAdminSettlementAccount();
        if (settle) setSettlementAcc(settle);

        const defs = await getAdminChitDefaults();
        if (defs) setChitDefaults(defs);

        const queue = await getPendingKycQueue();
        if (queue) setKycQueue(queue);
      }
      setMessage({ type: "", text: "" });
    } catch (err) {
      setMessage({ type: "danger", text: err.response?.data?.message || "Error loading profile details." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAvatarSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const validMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!validMimes.includes(file.type)) {
      alert("Invalid image format. Please select a JPEG, PNG, or WEBP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert("File size exceeds 2MB limit.");
      return;
    }
    setAvatarFile(file);
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreview(objectUrl);
  };

  const handleCancelAvatarSelect = () => {
    if (avatarPreview) {
      URL.revokeObjectURL(avatarPreview);
    }
    setAvatarFile(null);
    setAvatarPreview(null);
  };

  const handleSaveAvatar = async () => {
    if (!avatarFile) return;
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("avatar", avatarFile);
      const res = await uploadAvatar(formData);
      setMessage({ type: "success", text: res.message || "Profile photo updated successfully!" });
      handleCancelAvatarSelect();
      loadData();
    } catch (err) {
      setMessage({ type: "danger", text: err.response?.data?.message || "Failed to upload profile photo." });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleDeleteAvatar = async () => {
    if (!window.confirm("Are you sure you want to remove your profile photo?")) return;
    setUploadingAvatar(true);
    try {
      const res = await deleteAvatar();
      setMessage({ type: "success", text: res.message || "Profile photo removed." });
      handleCancelAvatarSelect();
      loadData();
    } catch (err) {
      setMessage({ type: "danger", text: err.response?.data?.message || "Failed to remove profile photo." });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleUpdatePersonal = async (e) => {
    e.preventDefault();
    try {
      await updateProfile({ name });
      setMessage({ type: "success", text: "Personal information updated successfully!" });
      loadData();
    } catch (err) {
      setMessage({ type: "danger", text: err.response?.data?.message || "Failed to update profile." });
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("File size exceeds 2MB limit.");
      return;
    }
    setDocFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => {
      setIdDocumentBase64(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitKyc = async (e) => {
    e.preventDefault();
    try {
      await submitKyc({
        pan_number: panNumber,
        aadhaar_number: aadhaarNumber,
        id_document_base64: idDocumentBase64,
        document_name: docFileName,
      });
      setMessage({ type: "success", text: "KYC credentials submitted successfully for Admin review." });
      setPanNumber("");
      setAadhaarNumber("");
      setIdDocumentBase64("");
      loadData();
    } catch (err) {
      setMessage({ type: "danger", text: err.response?.data?.message || "Failed to submit KYC." });
    }
  };

  const handleUpdateNotifPrefs = async (e) => {
    e.preventDefault();
    try {
      await updateNotificationPreferences(notifPrefs);
      setMessage({ type: "success", text: "Notification preferences saved!" });
    } catch (err) {
      setMessage({ type: "danger", text: "Failed to update notification preferences." });
    }
  };

  const handleUpdateSettlement = async (e) => {
    e.preventDefault();
    try {
      await updateAdminSettlementAccount(settlementAcc);
      setMessage({ type: "success", text: "Settlement account details updated successfully!" });
      loadData();
    } catch (err) {
      setMessage({ type: "danger", text: err.response?.data?.message || "Failed to update settlement account." });
    }
  };

  const handleUpdateDefaults = async (e) => {
    e.preventDefault();
    try {
      await updateAdminChitDefaults(chitDefaults);
      setMessage({ type: "success", text: "Global chit defaults updated!" });
    } catch (err) {
      setMessage({ type: "danger", text: "Failed to update defaults." });
    }
  };

  const handleReviewKyc = async (decision) => {
    if (!selectedKycReview) return;
    try {
      await reviewMemberKyc({
        kycId: selectedKycReview.kyc_id,
        decision,
        rejectionReason,
      });
      alert(`KYC submission ${decision.toLowerCase()} successfully!`);
      setSelectedKycReview(null);
      setRejectionReason("");
      loadData();
    } catch (err) {
      alert(err.response?.data?.message || "Error reviewing KYC");
    }
  };

  const handleLogoutOtherDevices = async () => {
    if (!window.confirm("Are you sure you want to log out from all other active devices?")) return;
    try {
      await logoutOtherDevices();
      alert("Logged out from all other devices successfully.");
      loadData();
    } catch (err) {
      alert("Failed to logout other devices.");
    }
  };

  const handleDeactivate = async () => {
    if (!window.confirm("WARNING: Are you sure you want to deactivate your account?")) return;
    try {
      await deactivateAccount(deactivateReason);
      alert("Your account has been deactivated.");
      localStorage.clear();
      navigate("/");
    } catch (err) {
      alert(err.response?.data?.message || "Cannot deactivate account at this time.");
    }
  };

  if (loading) {
    return <div className="glass-container text-center" style={{ padding: "4rem 0" }}>Loading Profile...</div>;
  }

  const isMember = userProfile?.role === "MEMBER";

  return (
    <div>
      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-brand" onClick={() => navigate(isMember ? "/member" : "/admin")} style={{ cursor: "pointer" }}>
          🪙 Smart Chit Fund
        </div>
        <div className="nav-links">
          <button className="btn btn-secondary" onClick={() => navigate(isMember ? "/member" : "/admin")}>
            ← Dashboard
          </button>
          <button className="btn btn-danger" onClick={() => { localStorage.clear(); navigate("/"); }}>
            Logout
          </button>
        </div>
      </nav>

      <div className="glass-container">
        {/* Profile Banner */}
        <div className="glass-card mb-8" style={{ display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
          <div style={{
            width: "80px",
            height: "80px",
            borderRadius: "50%",
            background: "var(--primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "2.5rem",
            color: "#fff",
            overflow: "hidden",
            flexShrink: 0
          }}>
            {(avatarPreview || userProfile?.avatarUrl) ? (
              <img src={avatarPreview || userProfile.avatarUrl} alt="Avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              userProfile?.name?.charAt(0) || "U"
            )}
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: "1.75rem" }}>{userProfile?.name}</h1>
            <p style={{ color: "var(--text-secondary)", margin: "0.25rem 0" }}>
              {userProfile?.role} | Phone: <strong>{userProfile?.phone}</strong> | Email: <strong>{userProfile?.email}</strong>
            </p>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <span className={`badge badge-${userProfile?.verification_status === "VERIFIED" ? "success" : "warning"}`}>
                KYC {userProfile?.verification_status}
              </span>
              <span className="badge badge-accent">Merit Score: {userProfile?.merit_score}/100</span>
            </div>
          </div>

          {/* Profile Photo Controls */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "flex-end" }}>
            <input
              type="file"
              id="avatarFileInput"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={handleAvatarSelect}
              style={{ display: "none" }}
            />
            
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {!avatarFile ? (
                <button
                  className="btn btn-secondary"
                  onClick={() => document.getElementById("avatarFileInput").click()}
                  disabled={uploadingAvatar}
                >
                  📷 {userProfile?.avatarUrl ? "Change Photo" : "Upload Photo"}
                </button>
              ) : (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={handleSaveAvatar}
                    disabled={uploadingAvatar}
                  >
                    {uploadingAvatar ? "Saving..." : "Save Photo"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={handleCancelAvatarSelect}
                    disabled={uploadingAvatar}
                  >
                    Cancel
                  </button>
                </>
              )}

              {userProfile?.avatarUrl && !avatarFile && (
                <button
                  className="btn btn-danger"
                  onClick={handleDeleteAvatar}
                  disabled={uploadingAvatar}
                >
                  Remove Photo
                </button>
              )}
            </div>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              JPEG, PNG or WEBP (Max 2MB)
            </span>
          </div>
        </div>

        {message.text && <div className={`alert alert-${message.type} mb-6`}>{message.text}</div>}

        {/* Tab Navigation */}
        <div className="btn-group mb-6" style={{ flexWrap: "wrap" }}>
          <button className={`btn ${activeTab === "personal" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveTab("personal")}>Personal Info</button>
          <button className={`btn ${activeTab === "kyc" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveTab("kyc")}>KYC & Verification</button>
          {isMember && <button className={`btn ${activeTab === "wallet" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveTab("wallet")}>Wallet Summary</button>}
          {!isMember && <button className={`btn ${activeTab === "kyc_queue" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveTab("kyc_queue")}>KYC Review Queue ({kycQueue.length})</button>}
          {!isMember && <button className={`btn ${activeTab === "settlement" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveTab("settlement")}>Settlement Account</button>}
          {!isMember && <button className={`btn ${activeTab === "defaults" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveTab("defaults")}>Chit Defaults</button>}
          <button className={`btn ${activeTab === "notifications" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveTab("notifications")}>Notification Preferences</button>
          <button className={`btn ${activeTab === "security" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveTab("security")}>Security & Sessions</button>
          <button className={`btn ${activeTab === "account" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveTab("account")}>Account Management</button>
        </div>

        {/* TAB 1: Personal Info */}
        {activeTab === "personal" && (
          <div className="glass-card">
            <h2 className="mb-4">Personal Information</h2>
            <form onSubmit={handleUpdatePersonal}>
              <div className="form-group mb-4">
                <label className="form-label">Full Name</label>
                <input type="text" className="form-input" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="form-group mb-4" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label className="form-label">Phone Number (Read-only)</label>
                  <input type="text" className="form-input" value={userProfile?.phone} disabled style={{ opacity: 0.7 }} />
                </div>
                <div>
                  <label className="form-label">Email Address (Read-only)</label>
                  <input type="text" className="form-input" value={userProfile?.email} disabled style={{ opacity: 0.7 }} />
                </div>
              </div>
              <button type="submit" className="btn btn-primary">Save Personal Info</button>
            </form>
          </div>
        )}

        {/* TAB 2: KYC & Verification */}
        {activeTab === "kyc" && (
          <div className="glass-card">
            <h2 className="mb-4">KYC Identity Verification</h2>

            {kycData && (
              <div className={`alert ${kycData.status === 'VERIFIED' ? 'alert-success' : kycData.status === 'REVIEW_REQUIRED' ? 'alert-warning' : 'alert-accent'} mb-6`}>
                <strong>Verification Status:</strong> {kycData.status} | <strong>Provider:</strong> {kycData.verification_provider || "NONE"}
                {kycData.rejection_reason && <p style={{ color: "var(--danger)", margin: "0.5rem 0 0 0" }}>Details / Reason: {kycData.rejection_reason}</p>}
                {kycData.aadhaar_number_masked && (
                  <div style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                    Masked Aadhaar: <strong>{kycData.aadhaar_number_masked}</strong>
                  </div>
                )}
              </div>
            )}

            {kycData?.status !== "VERIFIED" && (
              <div className="glass-card mb-8" style={{ border: "1px solid var(--accent-light)", padding: "1.5rem", textAlign: "center" }}>
                <h3 className="mb-2">Digital Identity Verification via DigiLocker</h3>
                <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
                  Verify your identity instantly using government e-KYC (DigiLocker / API Setu).
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      const res = await initiateKyc();
                      if (res.redirectUrl) {
                        window.location.href = res.redirectUrl;
                      }
                    } catch (err) {
                      const msg = err.response?.data?.message || err.message || "Failed to initiate DigiLocker verification.";
                      alert(msg);
                    }
                  }}
                  style={{ padding: "0.75rem 1.5rem", fontSize: "1rem" }}
                >
                  🔒 Start DigiLocker Identity Verification
                </button>
              </div>
            )}

            <h3 className="mb-3">KYC Timeline History</h3>
            {kycHistory.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>No submission history records found.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {kycHistory.map((item) => (
                  <div key={item.history_id} className="glass-card" style={{ padding: "0.75rem 1rem", margin: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <strong>Action: {item.action_type} ({item.status})</strong>
                      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{new Date(item.performed_at).toLocaleString()}</span>
                    </div>
                    <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0.25rem 0 0 0" }}>
                      Performed By: {item.actor_name} {item.rejection_reason && `| Reason: ${item.rejection_reason}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Member Wallet Summary */}
        {activeTab === "wallet" && isMember && (
          <div className="glass-card">
            <h2 className="mb-4">Wallet Balance & Shortcut</h2>
            <div className="stat-card success mb-6" style={{ maxWidth: "350px" }}>
              <span className="stat-label">Available Balance</span>
              <span className="stat-value" style={{ color: "var(--success)" }}>₹{Number(walletData?.balance || 0).toLocaleString("en-IN")}</span>
            </div>
            <div className="btn-group">
              <button className="btn btn-primary" onClick={() => navigate("/wallet")}>Go to Full Wallet & Transactions Panel</button>
            </div>
          </div>
        )}

        {/* TAB 4: Admin KYC Review Queue */}
        {activeTab === "kyc_queue" && !isMember && (
          <div className="glass-card">
            <h2 className="mb-4">Pending Member KYC Submissions ({kycQueue.length})</h2>
            {kycQueue.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>No pending KYC submissions to review.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Member Name</th>
                      <th>Phone</th>
                      <th>Masked PAN</th>
                      <th>Masked Aadhaar</th>
                      <th>Submitted At</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kycQueue.map((item) => (
                      <tr key={item.kyc_id}>
                        <td>{item.name}</td>
                        <td>{item.phone}</td>
                        <td>{item.pan_number_masked}</td>
                        <td>{item.aadhaar_number_masked}</td>
                        <td>{new Date(item.submitted_at).toLocaleDateString()}</td>
                        <td>
                          <button className="btn btn-primary" style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }} onClick={() => setSelectedKycReview(item)}>
                            Review Submission
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Review Modal */}
            {selectedKycReview && (
              <div className="glass-card" style={{ marginTop: "1.5rem", border: "1px solid var(--accent)" }}>
                <h3>Reviewing KYC for {selectedKycReview.name}</h3>
                <p>PAN: <strong>{selectedKycReview.pan_number_masked}</strong> | Aadhaar: <strong>{selectedKycReview.aadhaar_number_masked}</strong></p>
                
                <div className="form-group mb-4">
                  <label className="form-label">Rejection Reason (Mandatory if rejecting)</label>
                  <input type="text" className="form-input" placeholder="e.g. Invalid document upload" value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
                </div>

                <div className="btn-group">
                  <button className="btn btn-success" onClick={() => handleReviewKyc("VERIFIED")}>Approve & Verify KYC</button>
                  <button className="btn btn-danger" onClick={() => handleReviewKyc("REJECTED")}>Reject KYC</button>
                  <button className="btn btn-secondary" onClick={() => setSelectedKycReview(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: Admin Settlement Account */}
        {activeTab === "settlement" && !isMember && (
          <div className="glass-card">
            <h2 className="mb-4">Chit Settlement Bank Account</h2>
            <form onSubmit={handleUpdateSettlement}>
              <div className="form-group mb-4">
                <label className="form-label">Bank Name</label>
                <input type="text" className="form-input" placeholder="HDFC Bank" value={settlementAcc.bank_name} onChange={(e) => setSettlementAcc({ ...settlementAcc, bank_name: e.target.value })} required />
              </div>
              <div className="form-group mb-4">
                <label className="form-label">Account Holder Name</label>
                <input type="text" className="form-input" placeholder="Advent Chit Fund Admin" value={settlementAcc.account_holder_name} onChange={(e) => setSettlementAcc({ ...settlementAcc, account_holder_name: e.target.value })} required />
              </div>
              <div className="form-group mb-4">
                <label className="form-label">Account Number (Encrypted at rest)</label>
                <input type="text" className="form-input" placeholder={settlementAcc.account_number_masked || "Enter account number"} value={settlementAcc.account_number} onChange={(e) => setSettlementAcc({ ...settlementAcc, account_number: e.target.value })} required={!settlementAcc.account_number_masked} />
                {settlementAcc.account_number_masked && <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Masked Account Number: {settlementAcc.account_number_masked}</span>}
              </div>
              <div className="form-group mb-4">
                <label className="form-label">IFSC Code</label>
                <input type="text" className="form-input" placeholder="HDFC0001234" value={settlementAcc.ifsc_code} onChange={(e) => setSettlementAcc({ ...settlementAcc, ifsc_code: e.target.value })} required />
              </div>
              <div className="form-group mb-4">
                <label className="form-label">UPI ID (Optional)</label>
                <input type="text" className="form-input" placeholder="admin@upi" value={settlementAcc.upi_id || ""} onChange={(e) => setSettlementAcc({ ...settlementAcc, upi_id: e.target.value })} />
              </div>
              <button type="submit" className="btn btn-primary">Save Settlement Account Details</button>
            </form>
          </div>
        )}

        {/* TAB 6: Admin Chit Defaults */}
        {activeTab === "defaults" && !isMember && (
          <div className="glass-card">
            <h2 className="mb-4">Global Chit Defaults</h2>
            <form onSubmit={handleUpdateDefaults}>
              <div className="form-group mb-4">
                <label className="form-label">Default Grace Period (Days)</label>
                <input type="number" className="form-input" value={chitDefaults.default_grace_period_days} onChange={(e) => setChitDefaults({ ...chitDefaults, default_grace_period_days: Number(e.target.value) })} required />
              </div>
              <div className="form-group mb-4">
                <label className="form-label">Default Late Fee Rate (e.g. 0.02 = 2%)</label>
                <input type="number" step="0.001" className="form-input" value={chitDefaults.default_late_fee_rate} onChange={(e) => setChitDefaults({ ...chitDefaults, default_late_fee_rate: Number(e.target.value) })} required />
              </div>
              <button type="submit" className="btn btn-primary">Save Defaults</button>
            </form>
          </div>
        )}

        {/* TAB 7: Notification Preferences */}
        {activeTab === "notifications" && (
          <div className="glass-card">
            <h2 className="mb-4">Notification Channel Preferences</h2>
            <div className="alert alert-accent mb-6">
              🔒 <strong>Security Alert Policy:</strong> Critical security notices (password resets, device logouts, KYC updates) are mandatory and will always be delivered.
            </div>
            <form onSubmit={handleUpdateNotifPrefs}>
              <div className="form-group mb-4">
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input type="checkbox" checked={!!notifPrefs.in_app_enabled} onChange={(e) => setNotifPrefs({ ...notifPrefs, in_app_enabled: e.target.checked ? 1 : 0 })} />
                  In-App Notifications Enabled
                </label>
              </div>
              <div className="form-group mb-4">
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input type="checkbox" checked={!!notifPrefs.email_enabled} onChange={(e) => setNotifPrefs({ ...notifPrefs, email_enabled: e.target.checked ? 1 : 0 })} />
                  Email Notifications Enabled
                </label>
              </div>
              <div className="form-group mb-4">
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input type="checkbox" checked={!!notifPrefs.sms_enabled} onChange={(e) => setNotifPrefs({ ...notifPrefs, sms_enabled: e.target.checked ? 1 : 0 })} />
                  SMS Alerts Enabled
                </label>
              </div>
              <button type="submit" className="btn btn-primary">Save Channel Preferences</button>
            </form>
          </div>
        )}

        {/* TAB 8: Security & Active Sessions */}
        {activeTab === "security" && (
          <div className="glass-card">
            <h2 className="mb-4">Security & Device Sessions</h2>

            <div className="mb-6">
              <button className="btn btn-secondary mb-4" onClick={() => navigate("/forgot-password")}>Change Account Password</button>
            </div>

            <h3 className="mb-3">Active Device Sessions ({sessions.length})</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }} className="mb-6">
              {sessions.map((sess) => (
                <div key={sess.session_id} className="glass-card" style={{ padding: "0.75rem 1rem", margin: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{sess.device_info}</strong> {sess.is_current ? <span className="badge badge-success">Current Device</span> : null}
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.25rem 0 0 0" }}>
                      IP Address: {sess.ip_address} | Last Active: {new Date(sess.last_active_at).toLocaleString()}
                    </p>
                  </div>
                  {!sess.is_current && (
                    <button className="btn btn-danger" style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }} onClick={async () => { await logoutSession(sess.session_id); loadData(); }}>
                      Logout Device
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button className="btn btn-danger" onClick={handleLogoutOtherDevices}>Logout From All Other Devices</button>
          </div>
        )}

        {/* TAB 9: Account Management */}
        {activeTab === "account" && (
          <div className="glass-card mb-8">
            <h2 className="mb-4" style={{ color: "var(--danger)" }}>Account Deactivation</h2>
            <p style={{ color: "var(--text-secondary)" }}>
              Deactivating your account revokes all active login sessions and disables future account activity.
              All your historical ledger records, transactions, and audit logs remain permanently preserved in accordance with financial regulations.
            </p>
            <div className="form-group mb-4" style={{ maxWidth: "400px" }}>
              <label className="form-label">Deactivation Reason (Optional)</label>
              <input type="text" className="form-input" value={deactivateReason} onChange={(e) => setDeactivateReason(e.target.value)} placeholder="e.g. Taking a break" />
            </div>
            <button className="btn btn-danger" onClick={handleDeactivate}>Deactivate My Account</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProfilePage;
