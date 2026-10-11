import { io } from 'socket.io-client';

// Authenticated realtime connection; the server puts it in the user's family room
export const connectSocket = (token) =>
  io(import.meta.env.VITE_SOCKET_URL || undefined, { auth: { token }, reconnectionDelayMax: 10000 });
