const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    const error = new Error(data?.error || `Anfrage fehlgeschlagen (${res.status})`);
    error.code = data?.code;
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: (token) => request('/auth/me', { token }),
  changePassword: (token, currentPassword, newPassword) =>
    request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword }, token }),

  getFeed: (token) => request('/trainings/feed', { token }),
  getMine: (token) => request('/trainings/mine', { token }),
  getInterests: (token) => request('/trainings/interests', { token }),
  getInterested: (token, id) => request(`/trainings/${id}/interested`, { token }),
  createTraining: (token, training) => request('/trainings', { method: 'POST', body: training, token }),
  swipe: (token, id, direction) =>
    request(`/trainings/${id}/swipe`, { method: 'POST', body: { direction }, token }),

  getEmployees: (token) => request('/admin/employees', { token }),
  createEmployee: (token, employee) => request('/admin/employees', { method: 'POST', body: employee, token }),
  deleteEmployee: (token, id) => request(`/admin/employees/${id}`, { method: 'DELETE', token }),
};
