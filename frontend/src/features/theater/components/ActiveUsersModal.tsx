import React from 'react';
import { useTheater } from '../context/useTheater';
import type { ActiveUser } from '../context/useTheater';

interface ActiveUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ActiveUsersModal: React.FC<ActiveUsersModalProps> = ({ isOpen, onClose }) => {
  const { activeUsers, currentUserId, isHost, changeRole, kickUser } = useTheater();

  if (!isOpen) return null;

  return (
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-80 bg-neutral-900/95 border border-white/10 rounded-2xl shadow-2xl z-50 animate-slide-up backdrop-blur-md overflow-hidden">
      <div className="p-4 border-b border-white/10 flex justify-between items-center bg-neutral-800/50">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <span>👥</span> Participants ({activeUsers.length})
        </h3>
        <button 
          onClick={onClose}
          className="text-neutral-400 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto p-2">
        {activeUsers.map((user: ActiveUser) => {
          const isMe = user.userId === currentUserId;
          return (
            <div key={user.socketId} className="flex items-center justify-between p-2 hover:bg-white/5 rounded-xl transition-colors group">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-linear-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white shadow-md">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-neutral-200">
                    {user.name} {isMe && <span className="text-[10px] text-neutral-500 font-normal">(You)</span>}
                  </span>
                  <span className={`text-[10px] uppercase tracking-wider font-bold ${user.role === 'host' ? 'text-amber-400' : 'text-cyan-400'}`}>
                    {user.role}
                  </span>
                </div>
              </div>
              
              {/* Host Controls */}
              {isHost && !isMe && (
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <select 
                    value={user.role}
                    onChange={(e) => changeRole(user.userId, e.target.value)}
                    className="bg-neutral-950 border border-white/10 text-xs text-neutral-300 rounded px-1 py-1 focus:outline-none cursor-pointer"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="co-host">Co-Host</option>
                  </select>
                  <button
                    onClick={() => kickUser(user.userId)}
                    className="text-xs bg-red-500/20 text-red-400 hover:bg-red-500/40 px-2 py-1 rounded border border-red-500/30 transition-colors"
                  >
                    Kick
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
