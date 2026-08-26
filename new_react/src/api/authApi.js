import apiClient from "./client";

export const registerUser = (data) => {
  return apiClient.post("/auth/register", data);
};

export const loginUser = (data) => {
  return apiClient.post("/auth/login", data);
};

export const submitKyc = async (data) => {
  const response = await apiClient.post("/auth/kyc", data);
  return response.data;
};

export const requestPasswordReset = async (identifier) => {
  const response = await apiClient.post("/auth/forgot-password", { identifier });
  return response.data;
};

export const verifyResetOtp = async (phone, otp) => {
  const response = await apiClient.post("/auth/verify-reset-otp", { phone, otp });
  return response.data;
};

export const resetPassword = async (payload) => {
  const response = await apiClient.post("/auth/reset-password", payload);
  return response.data;
};

export const adminResetMemberPassword = async (memberId) => {
  const response = await apiClient.post("/auth/admin/reset-member-password", { memberId });
  return response.data;
};