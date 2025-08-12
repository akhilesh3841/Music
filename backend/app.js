const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin:"https://music-theta-rouge.vercel.app/",
    methods: ["GET", "POST"],
  },
});

app.use(
  cors({
    origin:"https://music-theta-rouge.vercel.app/",
  })
);
app.use(express.json());

const rooms = new Map();

io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);

  socket.on("joinRoom", ({ roomId, username }, callback) => {
    try {
      if (!roomId || !username) {
        throw new Error("Room ID and username are required");
      }

      socket.join(roomId);

      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          playlist: [],
          currentSong: null,
          currentIndex: 0,
          users: [],
          playbackStatus: "paused",
          currentTime: 0,
        });
      }

      const room = rooms.get(roomId);

      // Avoid duplicate users
      if (!room.users.some((u) => u.id === socket.id)) {
        room.users.push({ id: socket.id, username });
      }

      // Send current room state + playlist to the joining user
      if (callback)
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

      // Send playlist explicitly on join to this socket
      io.to(socket.id).emit("playlistUpdated", room.playlist);

      socket.to(roomId).emit("userJoined", username);
      io.to(roomId).emit("usersUpdated", room.users.map((u) => u.username));
    } catch (error) {
      if (callback) callback({ success: false, error: error.message });
    }
  });

  socket.on("playSong", ({ roomId, song }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");

      // If song not already in playlist, add it
      if (!room.playlist.find((s) => s.id === song.id)) {
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

      if (callback) callback({ success: true });
    } catch (error) {
      if (callback) callback({ success: false, error: error.message });
    }
  });

  socket.on("updatePlayback", ({ roomId, status, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.playbackStatus = status;
    room.currentTime = currentTime;

    socket.to(roomId).emit("playbackUpdate", {
      status,
      currentTime,
    });
  });

  socket.on("addSong", ({ roomId, song }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");

      // Avoid duplicates
      if (!room.playlist.find((s) => s.id === song.id)) {
        room.playlist.push(song);
        io.to(roomId).emit("playlistUpdated", room.playlist);
      }

      if (callback) callback({ success: true });
    } catch (error) {
      if (callback) callback({ success: false, error: error.message });
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

      if (callback) callback({ success: true });
    } catch (error) {
      if (callback) callback({ success: false, error: error.message });
    }
  });

  socket.on("prevSong", ({ roomId }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");
      if (room.playlist.length === 0) throw new Error("Playlist is empty");

      room.currentIndex =
        (room.currentIndex - 1 + room.playlist.length) % room.playlist.length;
      room.currentSong = room.playlist[room.currentIndex];
      room.playbackStatus = "playing";
      room.currentTime = 0;

      io.to(roomId).emit("songChanged", {
        song: room.currentSong,
        currentTime: 0,
        playbackStatus: "playing",
      });

      if (callback) callback({ success: true });
    } catch (error) {
      if (callback) callback({ success: false, error: error.message });
    }
  });

  socket.on("disconnect", () => {
    for (const [roomId, room] of rooms) {
      const userIndex = room.users.findIndex((user) => user.id === socket.id);
      if (userIndex !== -1) {
        const username = room.users[userIndex].username;
        room.users.splice(userIndex, 1);

        if (room.users.length > 0) {
          io.to(roomId).emit("userLeft", username);
          io.to(roomId).emit(
            "usersUpdated",
            room.users.map((u) => u.username)
          );
        }
      }
    }
  });
});

const PORT =5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
