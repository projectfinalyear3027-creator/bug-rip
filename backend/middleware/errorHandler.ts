/**
 * BUG RIP - Standardized API Error Handling Middleware
 * Guarantees consistent error formatting across all routes without leaking stack traces.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: any;

  constructor(message: string, statusCode: number = 400, code: string = 'BAD_REQUEST', details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  res.setHeader('Content-Type', 'application/json');

  // 1. Handle Zod validation errors
  if (err instanceof ZodError) {
    const issues = err.issues || (err as any).errors || [];
    return res.status(400).json({
      success: false,
      error: 'Request payload validation failed',
      code: 'VALIDATION_ERROR',
      details: issues.map((e: any) => ({
        field: e.path ? e.path.join('.') : 'unknown',
        message: e.message,
      })),
    });
  }

  // 2. Handle Custom Domain AppErrors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
      details: err.details,
    });
  }

  // 3. Unhandled Server Errors (Sanitized)
  console.error('Unhandled server exception:', err);
  return res.status(500).json({
    success: false,
    error: 'An internal server error occurred while processing the request.',
    code: 'INTERNAL_SERVER_ERROR',
  });
}
