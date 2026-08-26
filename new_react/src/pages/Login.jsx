import { useEffect, useState } from "react";
import { loginUser } from "../api/authApi";
import { useNavigate } from "react-router-dom";

function Login() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    phone: "",
    password: "",
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("user");
  }, []);

  const handleChange = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.phone || !form.password) {
      setErrorMessage("Please fill in all fields.");
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      const res = await loginUser(form);

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("role", res.data.role);
      localStorage.setItem(
        "user",
        JSON.stringify({
          id: res.data.user_id,
          role: res.data.role,
          phone: form.phone,
        })
      );

      if (res.data.role === "ADMIN") {
        navigate("/admin");
      } else {
        navigate("/member");
      }
    } catch (error) {
      setErrorMessage(
        error.response?.data?.message || "Invalid phone or password. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", padding: "1.5rem" }}>
      <div className="glass-card form-card" style={{ margin: 0, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div className="nav-brand" style={{ fontSize: "2rem", justifyContent: "center", marginBottom: "0.5rem" }}>
            🪙 Smart Chit Fund
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
            Secure Decentralized Chit Fund System
          </p>
        </div>

        <h2 className="form-title" style={{ fontSize: "1.5rem", marginBottom: "1.5rem" }}>Account Login</h2>

        {errorMessage && (
          <div className="alert alert-danger" style={{ marginBottom: "1.5rem" }}>
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit}>
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
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={form.password}
              onChange={handleChange}
              required
            />
            <div style={{ textAlign: "right", marginTop: "0.5rem" }}>
              <a href="/forgot-password" style={{ fontSize: "0.85rem", color: "var(--primary-light)", textDecoration: "none" }}>
                Forgot Password?
              </a>
            </div>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "1.5rem" }} disabled={loading}>
            {loading ? "Authenticating..." : "Login Securely"}
          </button>
        </form>

        <div style={{ marginTop: "2.5rem", textAlign: "center", borderTop: "1px solid var(--panel-border)", paddingTop: "1.5rem" }}>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Don't have an account yet? <a href="/register" style={{ fontWeight: "600" }}>Register here</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
