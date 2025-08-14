require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const ORIGINS = [
 "https://music-theta-rouge.vercel.app",
  "https://music-theta-rouge.vercel.app/",
  "http://localhost:5173",
  "http://localhost:5173/"
];

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: ORIGINS, credentials: true }));
app.get('/', (_, res) => res.json({ ok: true }));
app.get('/health', (_, res) => res.json({ ok: true }));

const io = new Server(server, {
  cors: { origin: ORIGINS, credentials: true },
  transports: ['polling', 'websocket'],
  pingTimeout: 30_000,
  pingInterval: 25_000,
  allowEIO3: true
});

const rooms = new Map();
const makeRoom = id =>
  rooms.set(id, {
    playlist: [],
    currentSong: null,
    currentIndex: 0,
    currentTime: 0,
    playbackStatus: 'paused',
    songStartTs: null,
    hostId: null,
    users: [],
    messages: []
  }).get(id);

const elapsed = r =>
  r.playbackStatus === 'playing' && r.songStartTs
    ? (Date.now() - r.songStartTs) / 1000 + (r.currentTime || 0)
    : r.currentTime;

//  ===================== SOCKET.IO ============================= 
io.on('connection', socket => {
  console.log('✓ client', socket.id);

  // -------------- JOIN --------------
  socket.on('joinRoom', ({ roomId, username }, cb) => {
    if (!roomId || !username)
      return cb?.({ success: false, error: 'Missing data' });

    socket.join(roomId);
    const room = rooms.get(roomId) ?? makeRoom(roomId);

    if (!room.users.find(u => u.id === socket.id))
      room.users.push({ id: socket.id, username });

    if (!room.hostId) room.hostId = socket.id;

    cb?.({
      success: true,
      roomState: {
        playlist: room.playlist,
        currentSong: room.currentSong,
        playbackStatus: room.playbackStatus,
        currentTime: elapsed(room),
        users: room.users,
        hostId: room.hostId
      }
    });

    io.to(roomId).emit('usersUpdated', room.users);
    io.to(roomId).emit('hostChanged', room.hostId);
  });

  // ------------- LEAVE --------------
  socket.on('leaveRoom', ({ roomId } = {}, cb) => {
    if (roomId) socket.leave(roomId);
    cb?.();
  });

  // ------------- CHAT ---------------
  socket.on('requestChat', ({ roomId }, cb) => {
    const r = rooms.get(roomId);
    cb?.({ success: true, history: r ? r.messages : [] });
  });

  socket.on('sendChat', ({ roomId, msg }, cb) => {
    const r = rooms.get(roomId);
    if (!r) return cb?.({ success: false });
    r.messages.push(msg);
    if (r.messages.length > 200) r.messages.shift();
    io.to(roomId).emit('newChat', msg);
    cb?.({ success: true });
  });

  // -------- ROOM STATE REQUEST ---------- (add this for React)
  socket.on('requestRoomState', ({ roomId }, cb) => {
    const r = rooms.get(roomId);
    if (!r)
      return cb?.({ success: false, error: 'No such room' });
    cb?.({
      success: true,
      roomState: {
        playlist: r.playlist,
        currentSong: r.currentSong,
        playbackStatus: r.playbackStatus,
        currentTime: elapsed(r),
        users: r.users,
        hostId: r.hostId
      }
    });
  });

  // ============= MUSIC EVENTS ===============

  // PLAY SONG
  socket.on('playSong', ({ roomId, song, startOffset = 0 }, cb) => {
    const r = rooms.get(roomId);
    if (!r) return cb?.({ success: false });

    r.currentSong = song;
    r.currentIndex = (r.playlist || []).findIndex(s => s.id === song.id);
    r.currentTime = startOffset;
    r.playbackStatus = 'playing';
    r.songStartTs = Date.now() - startOffset * 1000;
    r.hostId = socket.id;

    // maintain playlist
    if (!r.playlist.find(s => s.id === song.id)) r.playlist.push(song);

    io.to(roomId).emit('songChanged', {
      song: r.currentSong,
      currentTime: r.currentTime,
      playbackStatus: r.playbackStatus
    });
    io.to(roomId).emit('hostChanged', r.hostId);

    cb?.({ success: true });
  });

  // PLAYBACK UPDATE (pause/play/seek by host)
  socket.on('updatePlayback', ({ roomId, status, currentTime }, cb) => {
    const r = rooms.get(roomId);
    if (!r) return cb?.({ success: false });

    if (socket.id === r.hostId) {
      r.playbackStatus = status;
      r.currentTime = currentTime;
      r.songStartTs = status === 'playing' ? Date.now() - currentTime * 1000 : null;

      io.to(roomId).emit('playbackUpdate', {
        status: r.playbackStatus,
        currentTime: r.currentTime
      });
    }

    cb?.({ success: true });
  });

  // NEXT SONG
  socket.on('nextSong', ({ roomId }, cb) => {
    const r = rooms.get(roomId);
    if (!r) return cb?.({ success: false });

    if (!r.playlist.length) return cb?.({ success: false, error: 'No playlist' });

    let idx = r.currentIndex ?? 0;
    idx = (idx + 1) % r.playlist.length;
    r.currentIndex = idx;
    r.currentSong = r.playlist[idx];
    r.currentTime = 0;
    r.playbackStatus = 'playing';
    r.songStartTs = Date.now();
    r.hostId = socket.id;

    io.to(roomId).emit('songChanged', {
      song: r.currentSong,
      currentTime: 0,
      playbackStatus: 'playing'
    });
    io.to(roomId).emit('hostChanged', r.hostId);

    cb?.({ success: true });
  });

  // PREV SONG
  socket.on('prevSong', ({ roomId }, cb) => {
    const r = rooms.get(roomId);
    if (!r) return cb?.({ success: false });
    if (!r.playlist.length) return cb?.({ success: false, error: 'No playlist' });

    let idx = r.currentIndex ?? 0;
    idx = (idx - 1 + r.playlist.length) % r.playlist.length;
    r.currentIndex = idx;
    r.currentSong = r.playlist[idx];
    r.currentTime = 0;
    r.playbackStatus = 'playing';
    r.songStartTs = Date.now();
    r.hostId = socket.id;

    io.to(roomId).emit('songChanged', {
      song: r.currentSong,
      currentTime: 0,
      playbackStatus: 'playing'
    });
    io.to(roomId).emit('hostChanged', r.hostId);

    cb?.({ success: true });
  });

  // ------------ DISCONNECT ------------
  socket.on('disconnect', () => {
    for (const [roomId, r] of rooms) {
      const idx = r.users.findIndex(u => u.id === socket.id);
      if (idx === -1) continue;

      r.users.splice(idx, 1);
      if (r.hostId === socket.id) {
        r.hostId = r.users[0]?.id ?? null;

        // Transfer host, optionally pause playback
        if (!r.hostId) {
          r.playbackStatus = 'paused';
        }
        io.to(roomId).emit('hostChanged', r.hostId);
        io.to(roomId).emit('playbackUpdate', {
          status: r.playbackStatus,
          currentTime: r.currentTime
        });
      }
      io.to(roomId).emit('usersUpdated', r.users);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log('🚀 server on', PORT));