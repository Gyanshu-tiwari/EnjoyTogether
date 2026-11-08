import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useNotifications } from '../context/InvitationContext';
import { NotificationPopover } from './NotificationPopover';

export const NotificationBell: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { unreadCount } = useNotifications();
  const location = useLocation();

  // Close on route change
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Notifications"
        aria-expanded={isOpen}
        className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
          isOpen
            ? 'bg-neutral-800 text-white border border-neutral-700 shadow-md shadow-brand/10'
            : 'bg-neutral-900/80 hover:bg-neutral-800 text-neutral-400 hover:text-white border border-neutral-800'
        }`}
      >
        <Bell className="w-4 h-4 transition-transform duration-200 active:scale-90" />

        {/* Real-time unread count indicator */}
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-extrabold text-white bg-brand rounded-full ring-2 ring-neutral-950 shadow-sm animate-pulse"
            title={`${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Anchored Notification Dropdown */}
      <NotificationPopover
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        popoverRef={popoverRef}
      />
    </div>
  );
};
