import React, { useEffect, useRef, useState } from "react";
import axios from "axios";

const Songs = ({ socket, roomId }) => {
  const [songs, setSongs] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("bhojpuri");
  const [isLoading, setIsLoading] = useState(false);
  const [hostId, setHostId] = useState(null);

  const audioRef = useRef(null);
  const intervalRef = useRef(null);

  const fetchSongs = async (query = "bhojpuri") => {
    try {
      setIsLoading(true);
      const { data } = await axios.get(
        `https://jiosavan-api-with-playlist.vercel.app/api/search/songs?query=${query}&page=1&limit=500`
      );
      const results = data.data?.results || [];
      setSongs(results);
      setIsLoading(false);
    } catch {
      console.error("Failed to fetch songs");
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSongs(searchQuery);
  }, [searchQuery]);

  // Request room state when component mounts (so it can sync immediately)
  useEffect(() => {
    if (!socket || !roomId) return;

    socket.emit("requestRoomState", { roomId }, (response) => {
      if (response?.success && response.roomState) {
        const rs = response.roomState;
        setHostId(rs.hostId || null);
        if (rs.currentSong) {
          setCurrentSong(rs.currentSong);
          setCurrentIndex(rs.playlist.findIndex(s => s.id === rs.currentSong?.id) ?? 0);
          setCurrentTime(rs.currentTime ?? 0);
          setIsPlaying(rs.playbackStatus === "playing");

          if (audioRef.current) {
            audioRef.current.src = rs.currentSong.downloadUrl?.[4]?.url || "";
            audioRef.current.currentTime = rs.currentTime ?? 0;
            if (rs.playbackStatus === "playing") {
              audioRef.current.play().catch(() => {});
            } else {
              audioRef.current.pause();
            }
          }
        }
      }
    });

    // listen for host change notifications
    const onHostChanged = (newHostId) => {
      setHostId(newHostId);
    };
    socket.on("hostChanged", onHostChanged);

    return () => {
      socket.off("hostChanged", onHostChanged);
    };
  }, [socket, roomId]);

  // socket listeners for real-time events
  useEffect(() => {
    if (!socket) return;

    const onSongChanged = ({ song, currentTime: startTime, playbackStatus }) => {
      setCurrentSong(song);
      setCurrentTime(startTime || 0);
      setIsPlaying(playbackStatus === "playing");

      const newIndex = songs.findIndex(s => s.id === song.id);
      if (newIndex !== -1) setCurrentIndex(newIndex);

      if (audioRef.current) {
        audioRef.current.src = song.downloadUrl?.[4]?.url || "";
        audioRef.current.currentTime = startTime || 0;
        if (playbackStatus === "playing") {
          audioRef.current.play().catch(() => {});
        } else {
          audioRef.current.pause();
        }
      }
    };

    const onPlaybackUpdate = ({ status, currentTime: serverTime }) => {
      setIsPlaying(status === "playing");
      setCurrentTime(serverTime);

      if (audioRef.current) {
        // if drift > 1 second, correct
        if (Math.abs(audioRef.current.currentTime - serverTime) > 1) {
          audioRef.current.currentTime = serverTime;
        }
        if (status === "playing") audioRef.current.play().catch(() => {});
        else audioRef.current.pause();
      }
    };

    socket.on("songChanged", onSongChanged);
    socket.on("playbackUpdate", onPlaybackUpdate);

    return () => {
      socket.off("songChanged", onSongChanged);
      socket.off("playbackUpdate", onPlaybackUpdate);
    };
  }, [socket, songs]);

  // Send authoritative playback updates only if I am host
  useEffect(() => {
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (!audioRef.current) return;
      if (audioRef.current && isPlaying) {
        const t = audioRef.current.currentTime;
        setCurrentTime(t);

        // Only the host should emit updatePlayback
        if (socket && socket.id && hostId && socket.id === hostId) {
          socket.emit("updatePlayback", { roomId, status: "playing", currentTime: t }, (res) => {
            // optional: handle (res) if you want
          });
        }
      }
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [isPlaying, socket, roomId, hostId]);

  // When playSong is called from this client, server will set this client as host
  const playSong = (song) => {
    const songIndex = songs.findIndex(s => s.id === song.id);
    if (songIndex !== -1) setCurrentIndex(songIndex);

    setCurrentSong(song);
    setIsPlaying(true);
    setCurrentTime(0);

    if (audioRef.current) {
      audioRef.current.src = song.downloadUrl?.[4]?.url || "";
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }

    // emit playSong - server will set hostId = socket.id and broadcast songChanged
    socket.emit("playSong", { roomId, song, startOffset: 0 }, (res) => {
      // optional: check res.success
      if (res && !res.success) {
        console.warn("playSong failed:", res.error);
      }
    });
  };

  const handleNext = () => {
    // Only host should trigger nextSong server-side; but we can call playSong which sets host
    if (songs.length === 0) return;
    const nextIndex = (currentIndex + 1) % songs.length;
    const nextSong = songs[nextIndex];
    // call server nextSong only if this client is host (otherwise call playSong to become host)
    if (socket && socket.id && hostId && socket.id === hostId) {
      socket.emit("nextSong", { roomId }, (res) => {
        if (!res.success) {
          // fallback: play locally (will desync) or try to become host by calling playSong
          playSong(nextSong);
        }
      });
    } else {
      // become host via playSong
      playSong(nextSong);
    }
  };

  const handlePrev = () => {
    if (songs.length === 0) return;
    const prevIndex = (currentIndex - 1 + songs.length) % songs.length;
    const prevSong = songs[prevIndex];
    if (socket && socket.id && hostId && socket.id === hostId) {
      socket.emit("prevSong", { roomId }, (res) => {
        if (!res.success) {
          playSong(prevSong);
        }
      });
    } else {
      playSong(prevSong);
    }
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      setCurrentTime(audioRef.current.currentTime);

      // only host emits pause
      if (socket && socket.id && hostId && socket.id === hostId) {
        socket.emit("updatePlayback", { roomId, status: "paused", currentTime: audioRef.current.currentTime }, () => {});
      }
    } else {
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);

      // if not host, call playSong to become host (server will broadcast)
      if (socket && socket.id && hostId && socket.id === hostId) {
        socket.emit("updatePlayback", { roomId, status: "playing", currentTime: audioRef.current.currentTime }, () => {});
      } else {
        // become host by emitting playSong with current song and offset
        if (currentSong) {
          const offset = audioRef.current ? audioRef.current.currentTime : 0;
          socket.emit("playSong", { roomId, song: currentSong, startOffset: offset }, () => {});
        }
      }
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    const query = e.target.elements.search.value.trim();
    if (query) setSearchQuery(query);
  };

  const quickSearch = (language) => setSearchQuery(language);

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-3xl font-bold mb-6 text-center text-indigo-700">Music Player</h2>

      <div className="mb-6">
        <form onSubmit={handleSearch} className="flex gap-2 mb-3">
          <input type="text" name="search" placeholder="Search songs..." defaultValue={searchQuery}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors">Search</button>
        </form>

        <div className="flex gap-2">
          <button onClick={() => quickSearch("bhojpuri")} className={`px-3 py-1 rounded-md ${searchQuery === "bhojpuri" ? 'bg-indigo-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}>Bhojpuri</button>
          <button onClick={() => quickSearch("english")} className={`px-3 py-1 rounded-md ${searchQuery === "english" ? 'bg-indigo-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}>English</button>
          <button onClick={() => quickSearch("hindi")} className={`px-3 py-1 rounded-md ${searchQuery === "hindi" ? 'bg-indigo-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}>Hindi</button>
          <button onClick={() => quickSearch("punjabi")} className={`px-3 py-1 rounded-md ${searchQuery === "punjabi" ? 'bg-indigo-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}>Punjabi</button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading songs...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8">
          <div>
            <h3 className="text-xl font-semibold mb-3 text-gray-800">{searchQuery.charAt(0).toUpperCase() + searchQuery.slice(1)} Songs</h3>
            <ul className="max-h-80 overflow-y-auto border border-gray-200 rounded-md shadow-inner p-3">
              {songs.length === 0 ? (
                <li className="text-center py-4 text-gray-500">No songs found</li>
              ) : (
                songs.map((song) => (
                  <li key={song.id} className="mb-2">
                    <button onClick={() => playSong(song)} className={`w-full text-left px-4 py-2 rounded hover:bg-indigo-600 hover:text-white transition-colors duration-200 ${currentSong?.id === song.id ? "bg-indigo-100 font-medium" : ""}`}>
                      {song.name} - {song.primaryArtists || "Unknown Artist"}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="flex justify-center space-x-6">
            <button onClick={handlePrev} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded shadow transition duration-200">Prev</button>
            <button onClick={togglePlayPause} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded shadow transition duration-200">{isPlaying ? "Pause" : "Play"}</button>
            <button onClick={handleNext} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded shadow transition duration-200">Next</button>
          </div>
        </div>
      )}

      {currentSong && (
        <div className="mt-4 p-3 bg-indigo-50 rounded-md">
          <h3 className="font-semibold text-indigo-800">Now Playing:</h3>
          <p className="text-lg">{currentSong.name}</p>
          <p className="text-sm text-gray-600">{currentSong.primaryArtists || "Unknown Artist"}</p>
        </div>
      )}

      <audio ref={audioRef} />
      <div className="mt-2 text-sm text-gray-500">Host: {hostId === socket?.id ? "You" : hostId ? hostId : "none"}</div>
    </div>
  );
};

export default Songs;
