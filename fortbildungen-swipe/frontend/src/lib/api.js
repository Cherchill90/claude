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
    throw new Error(data?.error || `Anfrage fehlgeschlagen (${res.status})`);
  }
  return data;
}

export const api = {
  register: (name, password) => request('/auth/register', { method: 'POST', body: { name, password } }),
  login: (name, password) => request('/auth/login', { method: 'POST', body: { name, password } }),

  getFeed: (token) => request('/trainings/feed', { token }),
  getMine: (token) => request('/trainings/mine', { token }),
  getInterests: (token) => request('/trainings/interests', { token }),
  getInterested: (token, id) => request(`/trainings/${id}/interested`, { token }),
  createTraining: (token, training) => request('/trainings', { method: 'POST', body: training, token }),
  swipe: (token, id, direction) =>
    request(`/trainings/${id}/swipe`, { method: 'POST', body: { direction }, token }),
};
