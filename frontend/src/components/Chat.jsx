import { useEffect, useRef, useState } from 'react';
import { FaPaperPlane } from 'react-icons/fa';

export default function Chat({ socket, roomId, username }) {
  const [messages, setMessages] = useState([]);
  const [msg, setMsg]           = useState('');
  const bottomRef               = useRef(null);

  useEffect(() => {
    if (!socket || !roomId) return;
    socket.emit('requestChat', { roomId }, res => {
      if (res?.success) setMessages(res.history);
    });
    const push = m => setMessages(prev => [...prev, m]);
    socket.on('newChat', push);

    return () => socket.off('newChat', push);
  }, [socket, roomId]);

  const send = e => {
    e.preventDefault();
    const text = msg.trim();
    if (!text) return;
    const payload = { user: username, text, time: new Date().toISOString() };
    socket.emit('sendChat', { roomId, msg: payload }, res => {
      if (res?.success) setMsg('');
    });
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-lg ring-1 ring-black/5 overflow-hidden">
      <header className="bg-indigo-600 text-white px-6 py-3 text-lg font-semibold">
        Group Chat
      </header>
      <ul className="flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-gradient-to-b from-white to-indigo-50">
        {messages.map((m, i) => {
          const mine = m.user === username;
          return (
            <li key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              {!mine && (
                <div className="mr-2 shrink-0 h-8 w-8 rounded-full bg-indigo-400/30 flex items-center justify-center text-xs font-bold text-indigo-700">
                  {m.user[0]?.toUpperCase()}
                </div>
              )}
              <div
                className={`max-w-xs rounded-2xl px-4 py-2 text-sm leading-relaxed shadow ${mine
                    ? 'bg-indigo-600 text-white rounded-br-none'
                    : 'bg-white text-gray-800 rounded-bl-none'
                  }`}
              >
                <p className="font-medium mb-1">{mine ? 'You' : m.user}</p>
                <p>{m.text}</p>
                <span className="mt-1 block text-[10px] opacity-60">
                  {new Date(m.time).toLocaleTimeString()}
                </span>
              </div>
            </li>
          );
        })}
        <div ref={bottomRef} />
      </ul>
      <form onSubmit={send} className="border-t px-4 py-3 flex gap-3 bg-white">
        <input
          value={msg}
          onChange={e => setMsg(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 rounded-full border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
        />
        <button
          type="submit"
          disabled={!msg.trim()}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white p-3 rounded-full grid place-items-center"
        >
          <FaPaperPlane />
        </button>
      </form>
    </div>
  );
}