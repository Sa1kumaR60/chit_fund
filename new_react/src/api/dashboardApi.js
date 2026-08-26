import apiClient from "./client";

export const getAdminDashboard = async () => {
  const response = await apiClient.get("/dashboard/admin");
  return response.data;
};

export const getMemberDashboard = async () => {
  const response = await apiClient.get("/dashboard/member");
  return response.data;
};

export const getMonthlyReports = async () => {
  const response = await apiClient.get("/dashboard/reports");
  return response.data;
};
