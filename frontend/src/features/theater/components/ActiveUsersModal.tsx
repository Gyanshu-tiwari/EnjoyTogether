import React from 'react';
import { useTheater } from '../context/useTheater';
import type { ActiveUser } from '../context/useTheater';
import { Users, X } from 'lucide-react';
import { Avatar } from '@/shared/components/ui/Avatar';

interface ActiveUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ActiveUsersModal: React.FC<ActiveUsersModalProps> = ({ isOpen, onClose }) => {
  const { activeUsers, currentUserId, isHost, changeRole, kickUser } = useTheater();

  const uniqueUsers = React.useMemo(() => {
    const map = new Map<string, ActiveUser>();
    for (const user of activeUsers) {
      const key = (user.userId && user.userId !== 'guest') ? user.userId : (user.name || user.socketId);
      const existing = map.get(key);
      if (!existing || user.isHost || user.role === 'host') {
        map.set(key, user);
      }
    }
    return Array.from(map.values());
  }, [activeUsers]);

  if (!isOpen) return null;

  return (
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-80 bg-bg-card border border-white/5 rounded-2xl shadow-2xl z-50 animate-slide-up backdrop-blur-md overflow-hidden">
      <div className="p-4 border-b border-white/5 flex justify-between items-center bg-bg-primary/50">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-400" />
          <span>Participants ({uniqueUsers.length})</span>
        </h3>
        <button
          onClick={onClose}
          className="text-neutral-400 hover:text-white transition-colors p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto p-2">
        {uniqueUsers.map((user: ActiveUser) => {
          const isMe = user.userId === currentUserId;
          return (
            <div key={user.socketId} className="flex items-center justify-between p-2 hover:bg-white/5 rounded-xl transition-colors group">
              <div className="flex items-center gap-3">
                <Avatar
                  src={(user as any).avatarUrl}
                  fallback={user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                  size="sm"
                  className="shrink-0"
                />
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-neutral-200">
                    {user.name} {isMe && <span className="text-[10px] text-neutral-500 font-normal">(You)</span>}
                  </span>
                  <span className={`text-[10px] uppercase tracking-wider font-bold ${user.role === 'host' ? 'text-amber-400' : 'text-indigo-400'}`}>
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
                    className="bg-bg-primary border border-white/5 text-xs text-neutral-300 rounded px-1 py-1 focus:outline-none cursor-pointer"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="co-host">Co-Host</option>
                  </select>
                  <button
                    onClick={() => kickUser(user.userId)}
                    className="text-xs bg-red-500/20 text-red-400 hover:bg-red-500/40 px-2 py-1 rounded border border-red-500/20 transition-colors"
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
