import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { socket }   from '../socket';
import Songs        from './Songs';
import Chat         from './Chat';
import { FaUser, FaUsers, FaDoorOpen } from 'react-icons/fa';

export default function Home() {
  const checkuser = useSelector(state => state.user.checkuser);

  const [username , setUsername ] = useState('');
  const [roomId   , setRoomId   ] = useState('');
  const [users    , setUsers    ] = useState([]);
  const [error    , setError    ] = useState('');
  const [joined   , setJoined   ] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    socket.connect();
    socket.on('connect',    () => setConnected(true));
    socket.on('disconnect', () => {
      setConnected(false);
      setJoined(false);
      setError('Disconnected from server');
    });
    socket.on('usersUpdated', arr => setUsers(arr));
    return () => socket.disconnect();
  }, []);

  const joinRoom = () => {
    if (!username || !roomId)
      return setError('Username and Room ID required');
    if (!connected)
      return setError('Still connecting to server …');

    setError('');
    socket.emit('joinRoom', { roomId, username }, res => {
      if (res?.success) {
        setUsers(res.roomState.users);
        setJoined(true);
      } else setError(res?.error || 'Failed to join');
    });
  };

  const leaveRoom = () => {
    setJoined(false);
    setUsername('');
    setRoomId('');
    socket.emit('leaveRoom');
  };


  /* -------------------------------------------------- UI */
  if (checkuser)
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white text-2xl font-semibold">
        Welcome back!
      </div>
    );

  /* -------------- once joined ------------------- */
  if (joined)
    return (
      <div className="min-h-screen bg-gray-100 p-4 flex flex-col gap-6">
        {/* room header */}
        <div className="bg-white rounded-lg shadow-md p-4 flex flex-wrap gap-2 items-center justify-between">
          <div className="flex items-center gap-2 text-xl font-bold">
            <FaUsers /> Room&nbsp;<span className="text-indigo-600">{roomId}</span>
          </div>

          <button
            onClick={leaveRoom}
            className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold px-4 py-1.5 rounded"
          >
            <FaDoorOpen /> Leave
          </button>

          <div className="w-full border-t my-2" />

          {users.length
            ? (
              <ul className="flex flex-wrap gap-2">
                {users.map(u => (
                  <li
                    key={u.id}
                    className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-sm"
                  >
                    {u.username}
                  </li>
                ))}
              </ul>
            )
            : <p className="text-gray-400 italic">No users yet…</p>}
        </div>

        {/* grid: chat + songs */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Chat  socket={socket} roomId={roomId} username={username} />
          <Songs socket={socket} roomId={roomId} users={users} />
        </div>
      </div>
    );

  /* -------------- join form --------------------- */
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 px-4">
      <div className="bg-white/90 backdrop-blur-md rounded-3xl shadow-2xl max-w-md w-full p-8 border border-white/20">
        <h2 className="text-4xl font-extrabold mb-6 text-center bg-gradient-to-r from-pink-500 to-yellow-400 bg-clip-text text-transparent">
          Join a Music Room
        </h2>

        {error && (
          <p className="mb-4 text-center text-red-700 font-semibold bg-red-100 border border-red-300 p-2 rounded-lg">
            {error}
          </p>
        )}

        {/* username */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
            <FaUser className="text-pink-500" /> Username
          </label>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Enter your username"
            className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-pink-400 shadow-sm"
          />
        </div>

        {/* roomId */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
            <FaUsers className="text-indigo-500" /> Room ID
          </label>
          <input
            value={roomId}
            onChange={e => setRoomId(e.target.value)}
            placeholder="Enter Room ID"
            className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-400 shadow-sm"
          />
        </div>

        <button
          onClick={joinRoom}
          disabled={!username || !roomId || !connected}
          className={`w-full py-3 font-bold rounded-xl text-lg transition-all duration-300 ${
            username && roomId && connected
              ? 'bg-gradient-to-r from-pink-500 to-yellow-400 text-white hover:scale-105'
              : 'bg-gray-300 text-gray-100 cursor-not-allowed'
          }`}
        >
          {connected ? 'Join Room' : 'Connecting…'}
        </button>
      </div>
    </div>
  );
}