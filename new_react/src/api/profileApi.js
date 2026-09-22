import apiClient from "./client";

export const getProfile = async () => {
  const response = await apiClient.get("/profile");
  return response.data;
};

export const updateProfile = async (data) => {
  const response = await apiClient.put("/profile", data);
  return response.data;
};

export const uploadAvatar = async (formData) => {
  const response = await apiClient.post("/profile/avatar", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const deleteAvatar = async () => {
  const response = await apiClient.delete("/profile/avatar");
  return response.data;
};

export const initiateKyc = async () => {
  const response = await apiClient.post("/profile/kyc/initiate");
  return response.data;
};

export const processKycCallback = async (params) => {
  const response = await apiClient.post("/profile/kyc/callback", params);
  return response.data;
};

export const getKycStatus = async () => {
  const response = await apiClient.get("/profile/kyc/status");
  return response.data;
};

export const submitKyc = async (data) => {
  const response = await apiClient.post("/profile/kyc", data);
  return response.data;
};

export const getKycDetails = async () => {
  const response = await apiClient.get("/profile/kyc");
  return response.data;
};

export const getNotificationPreferences = async () => {
  const response = await apiClient.get("/profile/notification-preferences");
  return response.data;
};

export const updateNotificationPreferences = async (data) => {
  const response = await apiClient.put("/profile/notification-preferences", data);
  return response.data;
};

export const getAdminSettlementAccount = async () => {
  const response = await apiClient.get("/profile/settlement-account");
  return response.data;
};

export const updateAdminSettlementAccount = async (data) => {
  const response = await apiClient.put("/profile/settlement-account", data);
  return response.data;
};

export const getAdminChitDefaults = async () => {
  const response = await apiClient.get("/profile/chit-defaults");
  return response.data;
};

export const updateAdminChitDefaults = async (data) => {
  const response = await apiClient.put("/profile/chit-defaults", data);
  return response.data;
};

export const getPendingKycQueue = async () => {
  const response = await apiClient.get("/profile/admin/kyc-queue");
  return response.data;
};

export const reviewMemberKyc = async (data) => {
  const response = await apiClient.post("/profile/admin/review-kyc", data);
  return response.data;
};

export const getActiveSessions = async () => {
  const response = await apiClient.get("/profile/sessions");
  return response.data;
};

export const logoutSession = async (sessionId) => {
  const response = await apiClient.post("/profile/sessions/logout-session", { sessionId });
  return response.data;
};

export const logoutOtherDevices = async () => {
  const response = await apiClient.post("/profile/sessions/logout-other-devices");
  return response.data;
};

export const deactivateAccount = async (reason) => {
  const response = await apiClient.post("/profile/deactivate", { reason });
  return response.data;
};
