import axios from 'axios';
import { useAuth } from '../store/auth';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

api.interceptors.request.use((config) => {
  const { token } = useAuth.getState();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// An expired or revoked token sends the user back to the login screen
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const state = useAuth.getState();
    if (error.response?.status === 401 && state.token) state.logout();
    return Promise.reject(error);
  }
);

// Server validation errors look like { errors: [{ field, message }] } or { message }
export const errorMessage = (error, fallback = 'Something went wrong. Please try again.') => {
  const data = error?.response?.data;
  if (Array.isArray(data?.errors) && data.errors.length) return data.errors.map((e) => e.message).join(' ');
  return data?.message || (error?.response ? fallback : 'Cannot reach the server. Please try again.');
};
