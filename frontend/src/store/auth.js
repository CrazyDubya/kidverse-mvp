import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// sessionStorage (not localStorage): the token disappears when the tab closes, and storage
// access can throw (private windows, blocked storage), so fall back to in-memory only.
const safeSessionStorage = {
  getItem: (name) => {
    try {
      return window.sessionStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.sessionStorage.setItem(name, value);
    } catch {
      /* in-memory only */
    }
  },
  removeItem: (name) => {
    try {
      window.sessionStorage.removeItem(name);
    } catch {
      /* in-memory only */
    }
  }
};

export const useAuth = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      login: ({ token, user }) => set({ token, user }),
      logout: () => set({ token: null, user: null })
    }),
    { name: 'kidverse-auth', storage: createJSONStorage(() => safeSessionStorage) }
  )
);
