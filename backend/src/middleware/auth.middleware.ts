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
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Without Supabase configured, allow anonymous access in dev
      if (!process.env.SUPABASE_URL) {
        return next();
      }
      return next(new AppError('Unauthorized: Missing access token', 401));
    }

    const token = authHeader.split(' ')[1];
    if (!token) return next(new AppError('Unauthorized: Malformed authorization header', 401));

    if (!supabase) {
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
