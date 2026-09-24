/**
 * BUG RIP - Login Rate Limiting Middleware
 * Protects authentication endpoints against brute-force attacks.
 * Returns: "TOO MANY LOGIN ATTEMPTS. PLEASE TRY AGAIN SHORTLY."
 */

import { Request, Response, NextFunction } from 'express';

interface AttemptRecord {
  count: number;
  firstAttemptAt: number;
  blockedUntil?: number;
}

const loginAttempts = new Map<string, AttemptRecord>();

const WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_ATTEMPTS = 10; // Max 10 attempts per minute
const BLOCK_DURATION_MS = 60 * 1000; // 1 minute block

export function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = (req.ip || req.socket.remoteAddress || 'unknown').toString();
  const now = Date.now();

  const record = loginAttempts.get(ip);

  if (record) {
    // Check if currently blocked
    if (record.blockedUntil && now < record.blockedUntil) {
      return res.status(429).json({
        success: false,
        error: 'TOO MANY LOGIN ATTEMPTS. PLEASE TRY AGAIN SHORTLY.',
        code: 'TOO_MANY_ATTEMPTS',
      });
    }

    // Reset window if expired
    if (now - record.firstAttemptAt > WINDOW_MS) {
      loginAttempts.set(ip, { count: 1, firstAttemptAt: now });
      return next();
    }

    // Increment count
    record.count++;
    if (record.count > MAX_ATTEMPTS) {
      record.blockedUntil = now + BLOCK_DURATION_MS;
      return res.status(429).json({
        success: false,
        error: 'TOO MANY LOGIN ATTEMPTS. PLEASE TRY AGAIN SHORTLY.',
        code: 'TOO_MANY_ATTEMPTS',
      });
    }
  } else {
    loginAttempts.set(ip, { count: 1, firstAttemptAt: now });
  }

  next();
}

/**
 * Reset rate limiter (used for testing and admin resets)
 */
export function resetLoginRateLimiter() {
  loginAttempts.clear();
}

const adminLoginAttempts = new Map<string, AttemptRecord>();
const ADMIN_WINDOW_MS = 60 * 1000;
const ADMIN_MAX_ATTEMPTS = 5;
const ADMIN_BLOCK_DURATION_MS = 60 * 1000;

export function adminLoginRateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = (req.ip || req.socket.remoteAddress || 'unknown').toString();
  const now = Date.now();

  const record = adminLoginAttempts.get(ip);

  if (record) {
    if (record.blockedUntil && now < record.blockedUntil) {
      return res.status(429).json({
        success: false,
        error: 'INVALID ADMIN CREDENTIALS',
        code: 'RATE_LIMITED',
      });
    }

    if (now - record.firstAttemptAt > ADMIN_WINDOW_MS) {
      adminLoginAttempts.set(ip, { count: 1, firstAttemptAt: now });
      return next();
    }

    record.count++;
    if (record.count > ADMIN_MAX_ATTEMPTS) {
      record.blockedUntil = now + ADMIN_BLOCK_DURATION_MS;
      return res.status(429).json({
        success: false,
        error: 'INVALID ADMIN CREDENTIALS',
        code: 'RATE_LIMITED',
      });
    }
  } else {
    adminLoginAttempts.set(ip, { count: 1, firstAttemptAt: now });
  }

  next();
}

export function resetAdminLoginRateLimiter() {
  adminLoginAttempts.clear();
}

