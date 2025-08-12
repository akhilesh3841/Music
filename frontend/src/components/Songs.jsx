import React, { useEffect, useRef, useState } from "react";
import axios from "axios";

const Songs = ({ socket, roomId }) => {
  const [songs, setSongs] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("bhojpuri"); // Default search query
  const [isLoading, setIsLoading] = useState(false);

  const audioRef = useRef(null);
  const intervalRef = useRef(null);

  // Fetch songs based on search query
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

  // Fetch songs when component mounts or searchQuery changes
  useEffect(() => {
    fetchSongs(searchQuery);
  }, [searchQuery]);

  // Listen for song changes & playback updates from server
  useEffect(() => {
    if (!socket) return;

    socket.on("songChanged", ({ song, currentTime, playbackStatus }) => {
      setCurrentSong(song);
      setCurrentTime(currentTime);
      setIsPlaying(playbackStatus === "playing");

      // Update current index based on the new song
      const newIndex = songs.findIndex(s => s.id === song.id);
      if (newIndex !== -1) {
        setCurrentIndex(newIndex);
      }

      if (audioRef.current) {
        audioRef.current.src = song.downloadUrl?.[4]?.url || "";
        audioRef.current.currentTime = currentTime;
        playbackStatus === "playing"
          ? audioRef.current.play().catch(() => {})
          : audioRef.current.pause();
      }
    });

    socket.on("playbackUpdate", ({ status, currentTime }) => {
      setIsPlaying(status === "playing");
      setCurrentTime(currentTime);

      if (audioRef.current) {
        if (Math.abs(audioRef.current.currentTime - currentTime) > 1) {
          audioRef.current.currentTime = currentTime;
        }
        status === "playing"
          ? audioRef.current.play().catch(() => {})
          : audioRef.current.pause();
      }
    });

    return () => {
      socket.off("songChanged");
      socket.off("playbackUpdate");
    };
  }, [socket, songs]);

  // Sync current playback time to server every second when playing
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      if (audioRef.current && isPlaying) {
        setCurrentTime(audioRef.current.currentTime);
        socket.emit("updatePlayback", {
          roomId,
          status: "playing",
          currentTime: audioRef.current.currentTime,
        });
      }
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [isPlaying, roomId, socket]);

  const playSong = (song) => {
    const songIndex = songs.findIndex(s => s.id === song.id);
    if (songIndex !== -1) {
      setCurrentIndex(songIndex);
    }
    
    setCurrentSong(song);
    setIsPlaying(true);
    setCurrentTime(0);

    if (audioRef.current) {
      audioRef.current.src = song.downloadUrl?.[4]?.url || "";
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }

    socket.emit("playSong", { roomId, song });
  };

  const handleNext = () => {
    if (songs.length === 0) return;
    
    const nextIndex = (currentIndex + 1) % songs.length;
    const nextSong = songs[nextIndex];
    playSong(nextSong);
  };

  const handlePrev = () => {
    if (songs.length === 0) return;
    
    const prevIndex = (currentIndex - 1 + songs.length) % songs.length;
    const prevSong = songs[prevIndex];
    playSong(prevSong);
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      socket.emit("updatePlayback", { roomId, status: "paused", currentTime });
    } else {
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
      socket.emit("updatePlayback", { roomId, status: "playing", currentTime });
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    const query = e.target.elements.search.value.trim();
    if (query) {
      setSearchQuery(query);
    }
  };

  const quickSearch = (language) => {
    setSearchQuery(language);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-3xl font-bold mb-6 text-center text-indigo-700">Music Player</h2>

      {/* Search Section */}
      <div className="mb-6">
        <form onSubmit={handleSearch} className="flex gap-2 mb-3">
          <input
            type="text"
            name="search"
            placeholder="Search songs..."
            defaultValue={searchQuery}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button 
            type="submit"
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
          >
            Search
          </button>
        </form>
        
        <div className="flex gap-2">
          <button 
            onClick={() => quickSearch("bhojpuri")}
            className={`px-3 py-1 rounded-md ${searchQuery === "bhojpuri" ? 'bg-indigo-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
          >
            Bhojpuri
          </button>
          <button 
            onClick={() => quickSearch("english")}
            className={`px-3 py-1 rounded-md ${searchQuery === "english" ? 'bg-indigo-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
          >
            English
          </button>
          <button 
            onClick={() => quickSearch("hindi")}
            className={`px-3 py-1 rounded-md ${searchQuery === "hindi" ? 'bg-indigo-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
          >
            Hindi
          </button>
          <button 
            onClick={() => quickSearch("punjabi")}
            className={`px-3 py-1 rounded-md ${searchQuery === "punjabi" ? 'bg-indigo-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
          >
            Punjabi
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading songs...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8">
          {/* Song List */}
          <div>
            <h3 className="text-xl font-semibold mb-3 text-gray-800">
              {searchQuery.charAt(0).toUpperCase() + searchQuery.slice(1)} Songs
            </h3>
            <ul className="max-h-80 overflow-y-auto border border-gray-200 rounded-md shadow-inner p-3">
              {songs.length === 0 ? (
                <li className="text-center py-4 text-gray-500">No songs found</li>
              ) : (
                songs.map((song) => (
                  <li key={song.id} className="mb-2">
                    <button
                      onClick={() => playSong(song)}
                      className={`w-full text-left px-4 py-2 rounded hover:bg-indigo-600 hover:text-white transition-colors duration-200 ${
                        currentSong?.id === song.id ? "bg-indigo-100 font-medium" : ""
                      }`}
                    >
                      {song.name} - {song.primaryArtists || "Unknown Artist"}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>

          {/* Controls */}
          <div className="flex justify-center space-x-6">
            <button
              onClick={handlePrev}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded shadow transition duration-200"
            >
              Prev
            </button>
            <button
              onClick={togglePlayPause}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded shadow transition duration-200"
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              onClick={handleNext}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded shadow transition duration-200"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Current Song Info */}
      {currentSong && (
        <div className="mt-4 p-3 bg-indigo-50 rounded-md">
          <h3 className="font-semibold text-indigo-800">Now Playing:</h3>
          <p className="text-lg">{currentSong.name}</p>
          <p className="text-sm text-gray-600">{currentSong.primaryArtists || "Unknown Artist"}</p>
        </div>
      )}

      <audio ref={audioRef} />
    </div>
  );
};

export default Songs;