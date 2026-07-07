import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase.js';
import { AppError } from '../utils/AppError.js';

// Extend Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // If running locally without Supabase configured, let it pass
      if (!supabase) {
        return next();
      }
      return next(new AppError('Unauthorized: Missing access token', 401));
    }

    const token = authHeader.split(' ')[1];

    if (supabase) {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) {
        return next(new AppError('Unauthorized: Invalid or expired access token', 401));
      }
      req.user = user;
    }

    next();
  } catch (error) {
    next(error);
  }
};
