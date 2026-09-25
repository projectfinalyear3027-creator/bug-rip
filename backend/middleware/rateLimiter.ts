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

// -----------------------------------------------------------------------------
// Execution Rate Limiter: Max 30 runs per minute per IP/Session
// Prevents sandbox queue starvation while allowing continuous rapid debugging.
// -----------------------------------------------------------------------------
const executionAttempts = new Map<string, AttemptRecord>();
const EXEC_WINDOW_MS = 60 * 1000;
const EXEC_MAX_ATTEMPTS = 30;

export function executionRateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = req.sessionRecord?.id || (req.ip || req.socket.remoteAddress || 'unknown').toString();
  const now = Date.now();
  const record = executionAttempts.get(key);

  if (record) {
    if (now - record.firstAttemptAt > EXEC_WINDOW_MS) {
      executionAttempts.set(key, { count: 1, firstAttemptAt: now });
      return next();
    }
    record.count++;
    if (record.count > EXEC_MAX_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        error: 'Execution rate limit exceeded. Please wait a few seconds before submitting code again.',
        code: 'EXECUTION_RATE_LIMITED',
      });
    }
  } else {
    executionAttempts.set(key, { count: 1, firstAttemptAt: now });
  }

  next();
}

// -----------------------------------------------------------------------------
// Flag Submission Rate Limiter: Max 15 attempts per minute per IP/Session
// Prevents automated brute-force flag enumeration.
// -----------------------------------------------------------------------------
const flagAttempts = new Map<string, AttemptRecord>();
const FLAG_WINDOW_MS = 60 * 1000;
const FLAG_MAX_ATTEMPTS = 15;

export function flagSubmissionRateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = req.sessionRecord?.id || (req.ip || req.socket.remoteAddress || 'unknown').toString();
  const now = Date.now();
  const record = flagAttempts.get(key);

  if (record) {
    if (now - record.firstAttemptAt > FLAG_WINDOW_MS) {
      flagAttempts.set(key, { count: 1, firstAttemptAt: now });
      return next();
    }
    record.count++;
    if (record.count > FLAG_MAX_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        error: 'Too many flag submission attempts. Please slow down and inspect your program output.',
        code: 'FLAG_RATE_LIMITED',
      });
    }
  } else {
    flagAttempts.set(key, { count: 1, firstAttemptAt: now });
  }

  next();
}

// -----------------------------------------------------------------------------
// Anti-Cheat Ingestion Rate Limiter: Max 60 events per minute per IP/Session
// Prevents telemetry flooding.
// -----------------------------------------------------------------------------
const antiCheatAttempts = new Map<string, AttemptRecord>();
const AC_WINDOW_MS = 60 * 1000;
const AC_MAX_ATTEMPTS = 60;

export function antiCheatRateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = req.sessionRecord?.id || (req.ip || req.socket.remoteAddress || 'unknown').toString();
  const now = Date.now();
  const record = antiCheatAttempts.get(key);

  if (record) {
    if (now - record.firstAttemptAt > AC_WINDOW_MS) {
      antiCheatAttempts.set(key, { count: 1, firstAttemptAt: now });
      return next();
    }
    record.count++;
    if (record.count > AC_MAX_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        error: 'Anti-cheat event ingestion rate limit exceeded.',
        code: 'ANTI_CHEAT_RATE_LIMITED',
      });
    }
  } else {
    antiCheatAttempts.set(key, { count: 1, firstAttemptAt: now });
  }

  next();
}

export function resetAllRateLimiters() {
  loginAttempts.clear();
  adminLoginAttempts.clear();
  executionAttempts.clear();
  flagAttempts.clear();
  antiCheatAttempts.clear();
}

