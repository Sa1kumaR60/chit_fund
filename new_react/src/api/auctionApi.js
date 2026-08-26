import apiClient from "./client";

export const startAuction = async (payload) => {
  const response = await apiClient.post("/auctions/start", payload);
  return response.data;
};

export const getAuctionDetails = async (auctionId) => {
  const response = await apiClient.get(`/auctions/${auctionId}`);
  return response.data;
};

export const placeBid = async (auctionId, payload) => {
  const response = await apiClient.post(`/auctions/${auctionId}/bids`, payload);
  return response.data;
};

export const calculateAuctionResult = async (auctionId) => {
  const response = await apiClient.post(`/auctions/${auctionId}/calculate`);
  return response.data;
};
