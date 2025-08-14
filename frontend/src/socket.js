import { io } from "socket.io-client";

// Vite uses 'import.meta.env'. For Create React App, use 'process.env.REACT_APP_SOCKET_URL'
const URL =
  "http://localhost:5000" ||
  "https://music-sji4.onrender.com"; // fallback to production URL

export const socket = io(URL, {
  autoConnect: false,
  withCredentials: true
});