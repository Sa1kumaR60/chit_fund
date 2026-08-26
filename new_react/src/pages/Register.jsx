import { useState } from "react";
import { registerUser } from "../api/authApi";
import { useNavigate } from "react-router-dom";

function Register() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    role: "MEMBER",
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.phone || !form.email || !form.password) {
      setErrorMessage("Please fill in all fields.");
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      await registerUser(form);
      alert("Registration successful! You can now log in.");
      navigate("/");
    } catch (error) {
      console.log(error);
      setErrorMessage(
        error.response?.data?.message || "Registration failed. Phone or Email might already be registered."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", padding: "1.5rem" }}>
      <div className="glass-card form-card" style={{ margin: 0, width: "100%", maxWidth: "550px" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div className="nav-brand" style={{ fontSize: "2rem", justifyContent: "center", marginBottom: "0.5rem" }}>
            🪙 Smart Chit Fund
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
            Establish Trust, Mutual Savings & Payouts
          </p>
        </div>

        <h2 className="form-title" style={{ fontSize: "1.5rem", marginBottom: "1.5rem" }}>Create New Account</h2>

        {errorMessage && (
          <div className="alert alert-danger" style={{ marginBottom: "1.5rem" }}>
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="name">Full Name</label>
            <input
              id="name"
              name="name"
              type="text"
              className="form-input"
              placeholder="e.g. John Doe"
              value={form.name}
              onChange={handleChange}
              required
            />
          </div>

          <div className="grid-2" style={{ gap: "1rem" }}>
            <div className="form-group">
              <label className="form-label" htmlFor="phone">Phone Number</label>
              <input
                id="phone"
                name="phone"
                type="text"
                className="form-input"
                placeholder="e.g. 9876543210"
                value={form.phone}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="email">Email Address</label>
              <input
                id="email"
                name="email"
                type="email"
                className="form-input"
                placeholder="e.g. john@example.com"
                value={form.email}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <div className="grid-2" style={{ gap: "1rem" }}>
            <div className="form-group">
              <label className="form-label" htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                className="form-input"
                placeholder="Min 6 characters"
                value={form.password}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="role">Account Role</label>
              <select
                id="role"
                name="role"
                className="form-select"
                value={form.role}
                onChange={handleChange}
              >
                <option value="MEMBER">Member (Contributor)</option>
                <option value="ADMIN">Admin (First setup only)</option>
              </select>
            </div>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "1.5rem" }} disabled={loading}>
            {loading ? "Registering..." : "Create Account Securely"}
          </button>
        </form>

        <div style={{ marginTop: "2.5rem", textAlign: "center", borderTop: "1px solid var(--panel-border)", paddingTop: "1.5rem" }}>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Already have an account? <a href="/" style={{ fontWeight: "600" }}>Login here</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;
