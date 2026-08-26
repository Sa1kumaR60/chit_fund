import { BrowserRouter, Routes, Route } from "react-router-dom";

import ProtectedRoute from "./components/ProtectedRoute";
import AdminDashboard from "./pages/AdminDashboard";
import AuctionPage from "./pages/AuctionPage";
import ChitDetailsPage from "./pages/ChitDetailsPage";
import CreateChit from "./pages/CreateChit";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPasswordLink from "./pages/ResetPasswordLink";
import MemberDashboard from "./pages/MemberDashboard";
import PaymentPage from "./pages/PaymentPage";
import Register from "./pages/Register";
import WalletPage from "./pages/WalletPage";
import MonthlyReport from "./pages/MonthlyReport";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPasswordLink />} />
        <Route
          path="/create-chit"
          element={
            <ProtectedRoute allowedRole="ADMIN">
              <CreateChit />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRole="ADMIN">
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/member"
          element={
            <ProtectedRoute allowedRole="MEMBER">
              <MemberDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/wallet"
          element={
            <ProtectedRoute>
              <WalletPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/payments"
          element={
            <ProtectedRoute>
              <PaymentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/auctions"
          element={
            <ProtectedRoute>
              <AuctionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/monthly-reports"
          element={
            <ProtectedRoute allowedRole="ADMIN">
              <MonthlyReport />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chits/:chitId"
          element={
            <ProtectedRoute>
              <ChitDetailsPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
