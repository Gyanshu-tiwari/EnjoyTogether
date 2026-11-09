import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/appError.js';

// Extend Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; role?: string };
    }
  }
}

import { supabase } from '../config/supabase.js';

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // In production mode, always enforce real authentication token
      if (process.env.NODE_ENV === 'production') {
        return next(new AppError('Unauthorized: Missing access token', 401));
      }
      // In local dev / test / non-production mode, allow anonymous requests
      req.user = {
        id: (req.query.userId as string) || (req.body?.hostId as string) || 'anonymous-user',
        email: 'guest@local',
      };
      return next();
    }

    const token = authHeader.split(' ')[1];
    if (!token) return next(new AppError('Unauthorized: Malformed authorization header', 401));

    if (!supabase) {
      if (process.env.NODE_ENV === 'production') {
        return next(new AppError('Authentication service unavailable', 503));
      }
      console.warn('⚠️ authMiddleware bypassed: Supabase client not initialized.');
      return next();
    }

    // Official secure validation via Supabase API. Handles HS256/RS256 transparently.
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.error('Supabase Auth verification failed:', error?.message);
      return next(new AppError('Unauthorized: Invalid or expired access token', 401));
    }

    req.user = {
      id: user.id,
      email: user.email || user.id,
      ...(user.role !== undefined && { role: user.role }),
    };
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Permissive authentication middleware for room viewing & LiveKit calls:
 * Validates Supabase JWT when present, but gracefully permits unauthenticated guests
 * as 'viewer' so they can join LiveKit voice/video and be visible to participants.
 */
export const optionalAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const guestId = (req.query.user_id as string) || (req.query.userId as string) || (req.body?.guestId as string) || `anon_${Math.random().toString(36).substring(2, 9)}`;
      req.user = {
        id: guestId,
        email: `${guestId}@guest.local`,
        role: 'viewer',
      };
      return next();
    }

    const token = authHeader.split(' ')[1];
    if (!token || !supabase) {
      const guestId = (req.query.user_id as string) || (req.query.userId as string) || `anon_${Math.random().toString(36).substring(2, 9)}`;
      req.user = { id: guestId, email: `${guestId}@guest.local`, role: 'viewer' };
      return next();
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      const guestId = (req.query.user_id as string) || (req.query.userId as string) || `anon_${Math.random().toString(36).substring(2, 9)}`;
      req.user = { id: guestId, email: `${guestId}@guest.local`, role: 'viewer' };
      return next();
    }

    req.user = {
      id: user.id,
      email: user.email || user.id,
      ...(user.role !== undefined && { role: user.role }),
    };
    next();
  } catch {
    const guestId = (req.query.user_id as string) || (req.query.userId as string) || `anon_${Math.random().toString(36).substring(2, 9)}`;
    req.user = { id: guestId, email: `${guestId}@guest.local`, role: 'viewer' };
    next();
  }
};
