import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { io } from 'socket.io-client';
import Songs from './Songs';

const Home = () => {
  const checkuser = useSelector(state => state.user.checkuser);

  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);

  const socketRef = useRef(null);

  useEffect(() => {
    // Initialize socket once on mount
    socketRef.current = io('https://music-sji4.onrender.com/');

    socketRef.current.on('connect', () => {
      console.log('Connected to server:', socketRef.current.id);
    });

    socketRef.current.on('disconnect', () => {
      setError('Disconnected from server');
      setJoined(false);
    });

    socketRef.current.on('usersUpdated', (updatedUsers) => {
      console.log('usersUpdated event received:', updatedUsers);
      setUsers(updatedUsers);
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        console.log('Socket disconnected');
      }
    };
  }, []);

  const joinRoom = () => {
    if (!username || !roomId) {
      setError('Username and Room ID are required');
      return;
    }

    setError('');

    socketRef.current.emit('joinRoom', { roomId, username }, (response) => {
      if (response.success) {
        setUsers(response.roomState.users);
        setJoined(true);
        setError('');
      } else {
        setError(response.error || 'Failed to join room');
      }
    });
  };

  if (checkuser) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white text-xl font-semibold">
        Welcome back!
      </div>
    );
  }

  if (joined) {
    return (
      <div className="min-h-screen bg-gray-100 p-4 flex flex-col md:flex-row md:space-x-6">
        <div className="md:w-1/3 bg-white rounded-lg shadow-md p-6 mb-6 md:mb-0 sticky top-4 h-fit">
          <h2 className="text-2xl font-bold mb-4 text-gray-800">
            Room: <span className="text-indigo-600">{roomId}</span>
          </h2>
          <p className="mb-4 text-gray-700">
            <strong>Users:</strong>
            <span className="block mt-2 text-indigo-700 font-medium">
              {users.length > 0 ? users.join(', ') : 'No users yet'}
            </span>
          </p>
          <button
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 rounded transition"
            onClick={() => {
              setJoined(false);
              setUsername('');
              setRoomId('');
              socketRef.current.disconnect();
              socketRef.current = null;
            }}
          >
            Leave Room
          </button>
        </div>

        <div className="md:w-2/3 bg-white rounded-lg shadow-md p-6 overflow-auto">
          <Songs socket={socketRef.current} roomId={roomId} username={username} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 px-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-8">
        <h2 className="text-3xl font-bold mb-6 text-center text-indigo-700">Join a Music Room</h2>
        {error && (
          <p className="mb-4 text-center text-red-600 font-semibold bg-red-100 p-2 rounded">{error}</p>
        )}
        <input
          type="text"
          placeholder="Enter your username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full mb-4 px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <input
          type="text"
          placeholder="Enter Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          className="w-full mb-6 px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={joinRoom}
          disabled={!username || !roomId}
          className={`w-full py-3 font-semibold rounded transition ${
            username && roomId
              ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
              : 'bg-indigo-300 text-indigo-100 cursor-not-allowed'
          }`}
        >
          Join Room
        </button>
      </div>
    </div>
  );
};

export default Home;
