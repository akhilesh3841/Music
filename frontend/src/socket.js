import { io } from "socket.io-client";

const URL =
  import.meta.env.PROD
    ? "https://music-sji4.onrender.com"
    : "http://localhost:5000";

export const socket = io(URL, {
  autoConnect: false,
  withCredentials: true,
  transports: ["polling", "websocket"],
});

socket.on('connect_error', err => console.warn('connect_error →', err?.message));