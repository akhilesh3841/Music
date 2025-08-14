import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  FaPlay,
  FaPause,
  FaStepForward,
  FaStepBackward,
  FaMusic,
  FaSearch
} from 'react-icons/fa';

const Songs = ({ socket, roomId, users }) => {
  const [songs, setSongs] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('bhojpuri');
  const [searchInput, setSearchInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hostId, setHostId] = useState(null);
  const [progress, setProgress] = useState(0);

  const audioRef = useRef(null);
  const syncRef = useRef(null);

  const fetchSongs = async (q = 'bhojpuri') => {
    try {
      setIsLoading(true);
      const { data } = await axios.get(
        `https://jiosavan-api-with-playlist.vercel.app/api/search/songs?query=${q}&page=1&limit=500`
      );
      setSongs(data.data?.results || []);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSongs(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (!socket || !roomId) return;

    socket.emit('requestRoomState', { roomId }, (res) => {
      if (!res?.success) return;
      const st = res.roomState;
      setHostId(st.hostId);
      if (st.currentSong) {
        setCurrentSong(st.currentSong);
        setCurrentIndex(
          st.playlist.findIndex((s) => s.id === st.currentSong.id)
        );
        setIsPlaying(st.playbackStatus === 'playing');
        if (audioRef.current) {
          audioRef.current.src = st.currentSong.downloadUrl?.[4]?.url || '';
          audioRef.current.currentTime = st.currentTime;
          st.playbackStatus === 'playing'
            ? audioRef.current.play().catch(() => {})
            : audioRef.current.pause();
        }
      }
    });

    const hostChanged = (id) => setHostId(id);
    socket.on('hostChanged', hostChanged);
    return () => socket.off('hostChanged', hostChanged);
  }, [socket, roomId]);

  useEffect(() => {
    if (!socket) return;

    const songChanged = ({ song, currentTime, playbackStatus }) => {
      setCurrentSong(song);
      setIsPlaying(playbackStatus === 'playing');
      const idx = songs.findIndex((s) => s.id === song.id);
      if (idx !== -1) setCurrentIndex(idx);
      if (audioRef.current) {
        audioRef.current.src = song.downloadUrl?.[4]?.url || '';
        audioRef.current.currentTime = currentTime;
        playbackStatus === 'playing'
          ? audioRef.current.play().catch(() => {})
          : audioRef.current.pause();
      }
    };

    const playbackUpdate = ({ status, currentTime }) => {
      setIsPlaying(status === 'playing');
      if (audioRef.current) {
        if (Math.abs(audioRef.current.currentTime - currentTime) > 1)
          audioRef.current.currentTime = currentTime;
        status === 'playing'
          ? audioRef.current.play().catch(() => {})
          : audioRef.current.pause();
      }
    };

    socket.on('songChanged', songChanged);
    socket.on('playbackUpdate', playbackUpdate);
    return () => {
      socket.off('songChanged', songChanged);
      socket.off('playbackUpdate', playbackUpdate);
    };
  }, [socket, songs]);

  useEffect(() => {
    clearInterval(syncRef.current);
    syncRef.current = setInterval(() => {
      if (
        !audioRef.current ||
        !hostId ||
        socket.id !== hostId ||
        !isPlaying
      )
        return;
      socket.emit('updatePlayback', {
        roomId,
        status: 'playing',
        currentTime: audioRef.current.currentTime
      });
    }, 1000);
    return () => clearInterval(syncRef.current);
  }, [isPlaying, socket, hostId, roomId]);

  const playSong = (song) => {
    const idx = songs.findIndex((s) => s.id === song.id);
    setCurrentIndex(idx);
    setCurrentSong(song);
    setIsPlaying(true);
    if (audioRef.current) {
      audioRef.current.src = song.downloadUrl?.[4]?.url || '';
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
    socket.emit('playSong', { roomId, song, startOffset: 0 });
    setHostId(socket.id);
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      if (socket.id === hostId)
        socket.emit('updatePlayback', {
          roomId,
          status: 'paused',
          currentTime: audioRef.current.currentTime
        });
    } else {
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
      if (socket.id === hostId)
        socket.emit('updatePlayback', {
          roomId,
          status: 'playing',
          currentTime: audioRef.current.currentTime
        });
    }
  };

  const nextSong = () => {
    if (!songs.length) return;
    if (socket.id === hostId) socket.emit('nextSong', { roomId });
    else playSong(songs[(currentIndex + 1) % songs.length]);
  };

  const prevSong = () => {
    if (!songs.length) return;
    if (socket.id === hostId) socket.emit('prevSong', { roomId });
    else
      playSong(
        songs[(currentIndex - 1 + songs.length) % songs.length]
      );
  };

  const quickSearch = (l) => setSearchQuery(l);

  const submitSearch = (e) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setSearchQuery(searchInput.trim());
      setSearchInput('');
    }
  };

  const timeUpdate = () => {
    if (!audioRef.current || !currentSong?.duration) return;
    const prog =
      (audioRef.current.currentTime /
        audioRef.current.duration) *
      100;
    setProgress(isNaN(prog) ? 0 : prog);
  };

  const ended = () => {
    if (socket.id === hostId) socket.emit('nextSong', { roomId });
  };

  return (
    <div className="max-w-5xl mx-auto p-6 bg-gradient-to-b from-indigo-50 to-white rounded-2xl shadow-xl">
      <h2 className="text-4xl font-bold mb-6 text-center text-indigo-700 flex items-center justify-center gap-2">
        <FaMusic /> Music Player
      </h2>

      <form onSubmit={submitSearch} className="flex justify-center mb-6">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search for songs..."
          className="w-full max-w-md px-4 py-2 rounded-l-full border border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-indigo-600 text-white rounded-r-full hover:bg-indigo-700 flex items-center gap-2"
        >
          <FaSearch /> Search
        </button>
      </form>

      <div className="flex flex-wrap justify-center gap-3 mb-6">
        {['bhojpuri', 'english', 'hindi', 'punjabi'].map((l) => (
          <button
            key={l}
            onClick={() => quickSearch(l)}
            className={`px-5 py-2 rounded-full font-semibold transition-colors ${
              searchQuery === l
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'bg-white hover:bg-indigo-100 border border-indigo-300'
            }`}
          >
            {l[0].toUpperCase() + l.slice(1)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-14 w-14 border-t-4 border-b-4 border-indigo-500 mx-auto" />
          <p className="mt-3 text-gray-600 text-lg">Loading songs...</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-2xl font-semibold mb-4 text-indigo-700">
              {searchQuery[0].toUpperCase() + searchQuery.slice(1)} Songs
            </h3>
            <ul className="max-h-96 overflow-y-auto p-4 space-y-2 bg-white rounded-xl shadow-inner border border-indigo-200">
              {songs.length ? (
                songs.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => playSong(s)}
                      className={`w-full flex justify-between items-center px-4 py-2 rounded-lg transition-colors ${
                        currentSong?.id === s.id
                          ? 'bg-indigo-100 font-medium'
                          : 'bg-white hover:bg-indigo-600 hover:text-white'
                      }`}
                    >
                      <span>{s.name}</span>
                      <span className="text-sm text-gray-500">
                        {s.primaryArtists || 'Unknown Artist'}
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="text-center py-4 text-gray-500">
                  No songs found
                </li>
              )}
            </ul>
          </div>

          {currentSong && (
            <div className="flex flex-col items-center justify-center space-y-6 bg-indigo-50 p-6 rounded-xl shadow-lg">
              <div className="text-center">
                <h3 className="text-xl font-bold text-indigo-700 mb-1">
                  Now Playing
                </h3>
                <p className="text-2xl font-semibold">{currentSong.name}</p>
                <p className="text-gray-600">
                  {currentSong.primaryArtists || 'Unknown Artist'}
                </p>
              </div>

              <div className="w-full">
                <div className="h-2 bg-indigo-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              <div className="flex space-x-6 mt-4">
                <button
                  onClick={prevSong}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-full shadow-lg transition duration-200"
                >
                  <FaStepBackward />
                </button>
                <button
                  onClick={togglePlayPause}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-full shadow-lg transition duration-200"
                >
                  {isPlaying ? <FaPause /> : <FaPlay />}
                </button>
                <button
                  onClick={nextSong}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-full shadow-lg transition duration-200"
                >
                  <FaStepForward />
                </button>
              </div>

              <div className="text-sm text-gray-500">
                Host:{' '}
                {hostId === socket?.id
                  ? 'You'
                  : users?.find((u) => u.id === hostId)?.username || 'None'}
              </div>
            </div>
          )}
        </div>
      )}

      <audio
        ref={audioRef}
        onTimeUpdate={timeUpdate}
        onEnded={ended}
        hidden
      />
    </div>
  );
};

export default Songs;