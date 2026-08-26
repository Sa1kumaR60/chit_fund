import apiClient from "./client";

export const getWalletDetails = async () => {
  const response = await apiClient.get("/wallets/me");
  return response.data;
};

export const addFunds = async (payload) => {
  const response = await apiClient.post("/wallets/add-funds", payload);
  return response.data;
};
