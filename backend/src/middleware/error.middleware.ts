import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError.js';

export const errorMiddleware = (
  err: Error & { statusCode?: number; status?: string },
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const status = err.status || 'error';

  console.error('🔴 Exception caught by Express boundary:', err);

  res.status(statusCode).json({
    status,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
