import apiClient from "./client";

export const makePayment = async (payload) => {
  const response = await apiClient.post("/payments", payload);
  return response.data;
};

export const getPaymentStatus = async (chitId, memberId) => {
  const query = memberId ? `?member_id=${memberId}` : "";
  const response = await apiClient.get(`/payments/status/${chitId}${query}`);
  return response.data;
};
