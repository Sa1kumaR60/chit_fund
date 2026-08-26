import api from "./client";

export const getChits = async () => {
  const response = await api.get("/chits");
  return response.data;
};

export const getChitDetails = async (chitId) => {
  const response = await api.get(`/chits/${chitId}`);
  return response.data;
};

export const createChit = async (chitData) => {
  const response = await api.post("/chits", chitData);
  return response.data;
};

export const createWizardChit = async (data) => {
  const response = await api.post("/chits/wizard/create", data);
  return response.data;
};

export const saveMonthlyRules = async (chitId, monthly_rules) => {
  const response = await api.post(`/chits/wizard/${chitId}/rules`, { monthly_rules });
  return response.data;
};

export const configureMemberSlots = async (chitId, payload) => {
  const response = await api.post(`/chits/wizard/${chitId}/slots`, payload);
  return response.data;
};

export const getFinancialSimulationPreview = async (chitId) => {
  const response = await api.get(`/chits/wizard/${chitId}/simulation`);
  return response.data;
};

export const activateChit = async (chitId) => {
  const response = await api.post(`/chits/wizard/${chitId}/activate`);
  return response.data;
};

export const claimInviteToken = async (token) => {
  const response = await api.post("/chits/claim-invite", { token });
  return response.data;
};

export const inviteMember = async (chitId, phone) => {
  const response = await api.post(`/chits/${chitId}/invite`, { phone });
  return response.data;
};

export const getInvitations = async () => {
  const response = await api.get("/chits/invitations/me");
  return response.data;
};

export const acceptInvitation = async (invitationId) => {
  const response = await api.post(`/chits/invitations/${invitationId}/accept`);
  return response.data;
};

export const sendReminder = async (chitId, memberId) => {
  const response = await api.post(`/notifications/remind/${memberId}`, { chitId });
  return response.data;
};

export const getNotifications = async () => {
  const response = await api.get("/notifications");
  return response.data;
};

export const markNotificationAsRead = async (notificationId) => {
  const response = await api.put(`/notifications/${notificationId}/read`);
  return response.data;
};
