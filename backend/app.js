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
  "https://music-theta-rouge.vercel.app",
  "https://music-theta-rouge.vercel.app/",
  "http://localhost:5173",
  "http://localhost:5173/"
];

// CORS middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
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

// Room factory
const createRoom = (roomId) => {
  rooms.set(roomId, {
    playlist: [],
    currentSong: null,
    currentIndex: 0,
    users: [], // { id, username }
    playbackStatus: "paused",
    currentTime: 0, // used when paused
    songStartTimestamp: null, // ms when playback started (Date.now())
    hostId: null // socket.id of current host/timekeeper
  });
  return rooms.get(roomId);
};

const cleanupEmptyRooms = () => {
  for (const [roomId, room] of rooms) {
    if (room.users.length === 0) rooms.delete(roomId);
  }
};
setInterval(cleanupEmptyRooms, 60 * 60 * 1000); // hourly cleanup

// helper to broadcast users & host to room (keeps backward compatibility)
const broadcastUsers = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("usersUpdated", room.users.map(u => u.username));
  io.to(roomId).emit("hostChanged", room.hostId); // notify host id to clients
};

// helper to compute elapsed time (seconds)
const getElapsedSeconds = (room) => {
  if (!room) return 0;
  if (room.playbackStatus === "playing" && room.songStartTimestamp) {
    return (Date.now() - room.songStartTimestamp) / 1000;
  }
  return room.currentTime;
};

io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // joinRoom: adds user, returns current roomState (including elapsed & hostId)
  socket.on("joinRoom", ({ roomId, username }, callback) => {
    try {
      if (!roomId || !username) throw new Error("Room ID and username are required");
      if (typeof roomId !== 'string' || typeof username !== 'string') throw new Error("Invalid input types");

      socket.join(roomId);
      if (!rooms.has(roomId)) createRoom(roomId);

      const room = rooms.get(roomId);

      // add user if not present
      if (!room.users.some(u => u.id === socket.id)) {
        room.users.push({ id: socket.id, username });
      }

      // If no host yet, set this user as host (first user)
      if (!room.hostId) {
        room.hostId = socket.id;
      }

      const elapsed = getElapsedSeconds(room);

      if (typeof callback === "function") {
        callback({
          success: true,
          roomState: {
            currentSong: room.currentSong,
            playlist: room.playlist,
            playbackStatus: room.playbackStatus,
            currentTime: elapsed,
            users: room.users.map(u => u.username),
            hostId: room.hostId
          }
        });
      }

      // broadcast updated user list and host
      broadcastUsers(roomId);
      socket.to(roomId).emit("userJoined", username);
    } catch (error) {
      console.error("Join room error:", error);
      if (typeof callback === "function") callback({ success: false, error: error.message });
    }
  });

  // Client requests current room state after mounting
  socket.on("requestRoomState", ({ roomId }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) {
        if (typeof callback === "function") callback({ success: false, error: "Room not found" });
        return;
      }
      const elapsed = getElapsedSeconds(room);
      if (typeof callback === "function") {
        callback({
          success: true,
          roomState: {
            currentSong: room.currentSong,
            playlist: room.playlist,
            playbackStatus: room.playbackStatus,
            currentTime: elapsed,
            users: room.users.map(u => u.username),
            hostId: room.hostId
          }
        });
      }
    } catch (error) {
      console.error("requestRoomState error:", error);
      if (typeof callback === "function") callback({ success: false, error: error.message });
    }
  });

  // playSong: whoever triggers play becomes host (timekeeper)
  socket.on("playSong", ({ roomId, song, startOffset = 0 }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");
      if (!song?.id || !song?.name || !song?.downloadUrl) throw new Error("Invalid song format");

      // add song to playlist if not present
      if (!room.playlist.some((s) => s.id === song.id)) {
        room.playlist.push(song);
        io.to(roomId).emit("playlistUpdated", room.playlist);
      }

      // make this socket the host (so play control is from here onward)
      if (room.hostId !== socket.id) {
        room.hostId = socket.id;
        io.to(roomId).emit("hostChanged", room.hostId);
      }

      room.currentSong = song;
      room.currentIndex = room.playlist.findIndex((s) => s.id === song.id);
      room.playbackStatus = "playing";
      // store start timestamp so elapsed can be calculated by others
      room.songStartTimestamp = Date.now() - Math.floor(startOffset * 1000);
      room.currentTime = startOffset;

      io.to(roomId).emit("songChanged", {
        song,
        currentTime: startOffset,
        playbackStatus: "playing",
      });

      broadcastUsers(roomId);
      if (typeof callback === "function") callback({ success: true });
    } catch (error) {
      console.error("Play song error:", error);
      if (typeof callback === "function") callback({ success: false, error: error.message });
    }
  });

  // updatePlayback: only accept from host (to avoid conflicting updates)
  socket.on("updatePlayback", ({ roomId, status, currentTime }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) {
        if (typeof callback === "function") callback({ success: false, error: "Room not found" });
        return;
      }

      // Only host can update authoritative playback
      if (socket.id !== room.hostId) {
        // silently ignore or optionally inform
        if (typeof callback === "function") callback({ success: false, error: "Not host" });
        return;
      }

      if (!["playing", "paused"].includes(status)) throw new Error("Invalid playback status");

      room.playbackStatus = status;

      if (status === "playing") {
        // set start timestamp aligned with currentTime
        room.songStartTimestamp = Date.now() - Math.floor(currentTime * 1000);
      } else {
        // paused – store currentTime
        room.currentTime = currentTime;
        room.songStartTimestamp = null;
      }

      // Broadcast authoritative playbackUpdate to others
      socket.to(roomId).emit("playbackUpdate", { status, currentTime });

      if (typeof callback === "function") callback({ success: true });
    } catch (error) {
      console.error("Playback update error:", error);
      if (typeof callback === "function") callback({ success: false, error: error.message });
    }
  });

  // addSong: anybody can add, but doesn't change host/time
  socket.on("addSong", ({ roomId, song }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");
      if (!song?.id || !song?.name || !song?.downloadUrl) throw new Error("Invalid song format");

      if (!room.playlist.some((s) => s.id === song.id)) {
        room.playlist.push(song);
        io.to(roomId).emit("playlistUpdated", room.playlist);
      }

      if (typeof callback === "function") callback({ success: true });
    } catch (error) {
      console.error("Add song error:", error);
      if (typeof callback === "function") callback({ success: false, error: error.message });
    }
  });

  // nextSong / prevSong — only host should control timeline
  socket.on("nextSong", ({ roomId }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");
      if (room.playlist.length === 0) throw new Error("Playlist is empty");

      // Only allow host to change the song (so timeline stays consistent)
      if (socket.id !== room.hostId) {
        if (typeof callback === "function") callback({ success: false, error: "Not host" });
        return;
      }

      room.currentIndex = (room.currentIndex + 1) % room.playlist.length;
      room.currentSong = room.playlist[room.currentIndex];
      room.playbackStatus = "playing";
      room.currentTime = 0;
      room.songStartTimestamp = Date.now();

      io.to(roomId).emit("songChanged", {
        song: room.currentSong,
        currentTime: 0,
        playbackStatus: "playing",
      });

      if (typeof callback === "function") callback({ success: true });
    } catch (error) {
      console.error("Next song error:", error);
      if (typeof callback === "function") callback({ success: false, error: error.message });
    }
  });

  socket.on("prevSong", ({ roomId }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");
      if (room.playlist.length === 0) throw new Error("Playlist is empty");

      if (socket.id !== room.hostId) {
        if (typeof callback === "function") callback({ success: false, error: "Not host" });
        return;
      }

      room.currentIndex = (room.currentIndex - 1 + room.playlist.length) % room.playlist.length;
      room.currentSong = room.playlist[room.currentIndex];
      room.playbackStatus = "playing";
      room.currentTime = 0;
      room.songStartTimestamp = Date.now();

      io.to(roomId).emit("songChanged", {
        song: room.currentSong,
        currentTime: 0,
        playbackStatus: "playing",
      });

      if (typeof callback === "function") callback({ success: true });
    } catch (error) {
      console.error("Previous song error:", error);
      if (typeof callback === "function") callback({ success: false, error: error.message });
    }
  });

  // handle disconnect: remove user; if host left, promote new host
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    for (const [roomId, room] of rooms) {
      const userIndex = room.users.findIndex(user => user.id === socket.id);
      if (userIndex !== -1) {
        const username = room.users[userIndex].username;
        room.users.splice(userIndex, 1);

        // if host left, pick a new host (first remaining user)
        let hostChanged = false;
        if (room.hostId === socket.id) {
          room.hostId = room.users.length > 0 ? room.users[0].id : null;
          hostChanged = true;
        }

        // If host changed and playback was playing, adjust songStartTimestamp so new host's currentTime remains consistent
        // We already store currentTime when paused; if playing, compute currentTime and set songStartTimestamp relative to now
        if (hostChanged && room.playbackStatus === "playing") {
          // compute elapsed at disconnect moment (best-effort)
          const elapsed = getElapsedSeconds(room);
          room.songStartTimestamp = Date.now() - Math.floor(elapsed * 1000);
        }

        if (room.users.length > 0) {
          io.to(roomId).emit("userLeft", username);
          broadcastUsers(roomId);
        } else {
          // will be cleaned up by interval
          io.to(roomId).emit("usersUpdated", []);
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
