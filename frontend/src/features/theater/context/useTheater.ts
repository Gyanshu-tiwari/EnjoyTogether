import { createContext, useContext } from 'react';
import { Socket } from 'socket.io-client';

export interface Comment {
  user: string;
  text: string;
}

export interface KnockRequest {
  socketId: string;
  username: string;
}

export interface FloatingEmoji {
  id: string;
  emoji: string;
}

export interface TheaterContextType {
  roomId: string;
  socket: Socket | null;
  currentStreamUrl: string;
  setCurrentStreamUrl: (url: string) => void;
  comments: Comment[];
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  inputMessage: string;
  setInputMessage: (msg: string) => void;
  sendMessage: () => void;
  activeTab: 'chat' | 'call';
  setActiveTab: (tab: 'chat' | 'call') => void;
  sessionState: 'idle_host' | 'idle_guest' | 'knocking' | 'rejected' | 'active_session';
  isHost: boolean;
  startSession: () => Promise<void>;
  endSession: () => Promise<void>;
  loading: boolean;
  dbError: string | null;
  knocks: KnockRequest[];
  approveGuest: (socketId: string) => void;
  rejectGuest: (socketId: string) => void;
  sendEmoji: (emoji: string) => void;
  floatingEmojis: FloatingEmoji[];
}

export const TheaterContext = createContext<TheaterContextType | undefined>(undefined);

export const useTheater = () => {
  const context = useContext(TheaterContext);
  if (!context) {
    throw new Error('useTheater must be used within a TheaterProvider');
  }
  return context;
};
