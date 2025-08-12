require('dotenv').config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const server = http.createServer(app);

// Configure allowed origins
const allowedOrigins = [
  "https://music-theta-rouge.vercel.app", // Without trailing slash
  "https://music-theta-rouge.vercel.app/", // With trailing slash
  "http://localhost:5173", // Local dev
  "http://localhost:5173/" // Local dev with slash
];

// CORS middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // allow no-origin requests
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST", "OPTIONS"],
  credentials: true
}));

// Additional headers middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || "*");
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

app.use(express.json());

// Socket.IO configuration
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

const rooms = new Map();

// Room management
const createRoom = (roomId) => {
  rooms.set(roomId, {
    playlist: [],
    currentSong: null,
    currentIndex: 0,
    users: [],
    playbackStatus: "paused",
    currentTime: 0,
  });
  return rooms.get(roomId);
};

const cleanupEmptyRooms = () => {
  for (const [roomId, room] of rooms) {
    if (room.users.length === 0) {
      rooms.delete(roomId);
    }
  }
};
setInterval(cleanupEmptyRooms, 60 * 60 * 1000); // hourly cleanup

// Socket.IO events
io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);

  socket.on("joinRoom", ({ roomId, username }, callback) => {
    try {
      if (!roomId || !username) throw new Error("Room ID and username are required");
      if (typeof roomId !== 'string' || typeof username !== 'string') throw new Error("Invalid input types");

      socket.join(roomId);
      if (!rooms.has(roomId)) createRoom(roomId);

      const room = rooms.get(roomId);
      if (!room.users.some((u) => u.id === socket.id)) {
        room.users.push({ id: socket.id, username });
      }

      if (typeof callback === "function") {
        callback({
          success: true,
          roomState: {
            currentSong: room.currentSong,
            playlist: room.playlist,
            playbackStatus: room.playbackStatus,
            currentTime: room.currentTime,
            users: room.users.map((u) => u.username),
          },
        });
      }

      socket.to(roomId).emit("userJoined", username);
      io.to(roomId).emit("usersUpdated", room.users.map((u) => u.username));
    } catch (error) {
      console.error("Join room error:", error);
      if (typeof callback === "function") {
        callback({ success: false, error: error.message });
      }
    }
  });

  socket.on("playSong", ({ roomId, song }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");
      if (!song?.id || !song?.name || !song?.downloadUrl) throw new Error("Invalid song format");

      if (!room.playlist.some((s) => s.id === song.id)) {
        room.playlist.push(song);
        io.to(roomId).emit("playlistUpdated", room.playlist);
      }

      room.currentSong = song;
      room.currentIndex = room.playlist.findIndex((s) => s.id === song.id);
      room.playbackStatus = "playing";
      room.currentTime = 0;

      io.to(roomId).emit("songChanged", {
        song,
        currentTime: 0,
        playbackStatus: "playing",
      });

      if (typeof callback === "function") {
        callback({ success: true });
      }
    } catch (error) {
      console.error("Play song error:", error);
      if (typeof callback === "function") {
        callback({ success: false, error: error.message });
      }
    }
  });

  socket.on("updatePlayback", ({ roomId, status, currentTime }) => {
    try {
      const room = rooms.get(roomId);
      if (!room) return;
      if (!["playing", "paused"].includes(status)) throw new Error("Invalid playback status");

      room.playbackStatus = status;
      room.currentTime = currentTime;

      socket.to(roomId).emit("playbackUpdate", { status, currentTime });
    } catch (error) {
      console.error("Playback update error:", error);
    }
  });

  socket.on("addSong", ({ roomId, song }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");
      if (!song?.id || !song?.name || !song?.downloadUrl) throw new Error("Invalid song format");

      if (!room.playlist.some((s) => s.id === song.id)) {
        room.playlist.push(song);
        io.to(roomId).emit("playlistUpdated", room.playlist);
      }

      if (typeof callback === "function") {
        callback({ success: true });
      }
    } catch (error) {
      console.error("Add song error:", error);
      if (typeof callback === "function") {
        callback({ success: false, error: error.message });
      }
    }
  });

  socket.on("nextSong", ({ roomId }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");
      if (room.playlist.length === 0) throw new Error("Playlist is empty");

      room.currentIndex = (room.currentIndex + 1) % room.playlist.length;
      room.currentSong = room.playlist[room.currentIndex];
      room.playbackStatus = "playing";
      room.currentTime = 0;

      io.to(roomId).emit("songChanged", {
        song: room.currentSong,
        currentTime: 0,
        playbackStatus: "playing",
      });

      if (typeof callback === "function") {
        callback({ success: true });
      }
    } catch (error) {
      console.error("Next song error:", error);
      if (typeof callback === "function") {
        callback({ success: false, error: error.message });
      }
    }
  });

  socket.on("prevSong", ({ roomId }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");
      if (room.playlist.length === 0) throw new Error("Playlist is empty");

      room.currentIndex = (room.currentIndex - 1 + room.playlist.length) % room.playlist.length;
      room.currentSong = room.playlist[room.currentIndex];
      room.playbackStatus = "playing";
      room.currentTime = 0;

      io.to(roomId).emit("songChanged", {
        song: room.currentSong,
        currentTime: 0,
        playbackStatus: "playing",
      });

      if (typeof callback === "function") {
        callback({ success: true });
      }
    } catch (error) {
      console.error("Previous song error:", error);
      if (typeof callback === "function") {
        callback({ success: false, error: error.message });
      }
    }
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    for (const [roomId, room] of rooms) {
      const userIndex = room.users.findIndex((user) => user.id === socket.id);
      if (userIndex !== -1) {
        const username = room.users[userIndex].username;
        room.users.splice(userIndex, 1);
        if (room.users.length > 0) {
          io.to(roomId).emit("userLeft", username);
          io.to(roomId).emit("usersUpdated", room.users.map((u) => u.username));
        }
      }
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});
