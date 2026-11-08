import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError.js';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
}

interface ClientTracker {
  count: number;
  resetTime: number;
}

export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max, message = 'Too many requests. Please try again later.' } = options;
  const clients = new Map<string, ClientTracker>();

  // Periodic cleanup of stale clients
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, tracker] of clients.entries()) {
      if (now > tracker.resetTime) {
        clients.delete(key);
      }
    }
  }, Math.max(windowMs, 60000));
  cleanupInterval.unref();

  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();
    // Key by user id if authenticated, or IP
    const clientId = req.user?.id || req.ip || req.socket.remoteAddress || 'unknown-client';

    let tracker = clients.get(clientId);
    if (!tracker || now > tracker.resetTime) {
      tracker = { count: 1, resetTime: now + windowMs };
      clients.set(clientId, tracker);
      return next();
    }

    tracker.count++;
    if (tracker.count > max) {
      return next(new AppError(message, 429));
    }

    next();
  };
}

/** Pre-configured rate limiter for exact 6-digit code lookup (25 lookups / min) */
export const codeLookupRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 25,
  message: 'Too many friend code lookup attempts. Please try again after a minute.',
});

/**
 * Rate limiter for guest session endpoints.
 * Note: Process-local in-memory sliding window limiter. For multi-instance horizontal scaling,
 * a distributed key-value store (e.g., Redis) or PostgreSQL rate-limit table should be used.
 *
 * Enforces:
 * - Max 10 new guest allocations / minute per IP (prevents 6-digit namespace exhaustion)
 * - Max 30 session restoration requests / minute per IP (accommodates legitimate multi-tab/refresh usage)
 * - Cannot be bypassed by cycling client-provided guestIds.
 */
export function createGuestSessionRateLimiter() {
  const windowMs = 60 * 1000;
  const newAllocationLimit = 10;
  const restorationLimit = 30;

  const allocationClients = new Map<string, ClientTracker>();
  const restorationClients = new Map<string, ClientTracker>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, tracker] of allocationClients.entries()) {
      if (now > tracker.resetTime) allocationClients.delete(key);
    }
    for (const [key, tracker] of restorationClients.entries()) {
      if (now > tracker.resetTime) restorationClients.delete(key);
    }
  }, 60000);
  cleanupInterval.unref();

  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();
    // Strictly key by IP to prevent bypass by cycling guestIds
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown-client';
    const isRestoration = Boolean(req.body?.guestId && (req.body?.sessionSecret || req.headers['x-guest-secret']));

    const clientMap = isRestoration ? restorationClients : allocationClients;
    const maxLimit = isRestoration ? restorationLimit : newAllocationLimit;
    const message = isRestoration
      ? 'Too many guest session restoration attempts. Please try again later.'
      : 'Too many guest session creations. Please try again after a minute.';

    let tracker = clientMap.get(clientIp);
    if (!tracker || now > tracker.resetTime) {
      tracker = { count: 1, resetTime: now + windowMs };
      clientMap.set(clientIp, tracker);
      return next();
    }

    tracker.count++;
    if (tracker.count > maxLimit) {
      return next(new AppError(message, 429));
    }

    next();
  };
}

export const guestSessionRateLimiter = createGuestSessionRateLimiter();

export const guestRevokeRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many guest session revocation requests. Please try again later.',
});
