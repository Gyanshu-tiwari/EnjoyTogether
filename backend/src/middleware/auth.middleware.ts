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

/**
 * Verify a Supabase JWT locally without making a network call.
 *
 * This avoids the EAI_AGAIN / DNS failure pattern seen inside Docker containers
 * when supabase.auth.getUser(token) tries to reach the Supabase API endpoint.
 *
 * The JWT is signed with SUPABASE_JWT_SECRET which is available as an env var
 * from your Supabase project settings → API → JWT Secret.
 */
function verifySupabaseJwt(token: string): { sub: string; email: string; role?: string } | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    console.error('SUPABASE_JWT_SECRET is missing. Cannot verify tokens.');
    return null;
  }

  try {
    const payload = jwt.verify(token, secret) as {
      sub?: string;
      email?: string;
      role?: string;
      iss?: string;
    };

    const supabaseUrl = process.env.SUPABASE_URL || '';
    if (supabaseUrl && payload.iss && !payload.iss.includes(new URL(supabaseUrl).hostname)) {
      return null;
    }

    if (!payload.sub) return null;

    return {
      sub: payload.sub,
      email: payload.email || payload.sub,
      ...(payload.role !== undefined && { role: payload.role }),
    };
  } catch (err) {
    return null;
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
      // Without Supabase configured, allow anonymous access in dev
      if (!process.env.SUPABASE_URL) {
        return next();
      }
      return next(new AppError('Unauthorized: Missing access token', 401));
    }

    const token = authHeader.split(' ')[1];
    if (!token) return next(new AppError('Unauthorized: Malformed authorization header', 401));

    // Local JWT decode — no network call, no DNS risk
    const payload = verifySupabaseJwt(token);
    if (!payload) {
      return next(new AppError('Unauthorized: Invalid or expired access token', 401));
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      ...(payload.role !== undefined && { role: payload.role }),
    };
    next();
  } catch (error) {
    next(error);
  }
};
