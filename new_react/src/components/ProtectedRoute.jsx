import { Navigate } from "react-router-dom";

function ProtectedRoute({ children, allowedRole }) {
  const storedUser = localStorage.getItem("user");
  const user = storedUser ? JSON.parse(storedUser) : null;
  const storedRole = localStorage.getItem("role");
  const effectiveRole = user?.role || storedRole;

  if (!localStorage.getItem("token")) {
    return <Navigate to="/" />;
  }

  if (allowedRole && effectiveRole !== allowedRole) {
    return <Navigate to="/" />;
  }

  return children;
}

export default ProtectedRoute;
