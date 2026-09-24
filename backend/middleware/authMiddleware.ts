/**
 * BUG RIP - Participant and Admin Authentication Middleware
 * Enforces:
 * 1. Participant session validation (HTTP-only cookie or Bearer token)
 * 2. Team-level isolation (server derives team identity, never frontend input)
 * 3. Strict separation of Admin endpoints from Participant tokens
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { teamRepository } from '../repositories/teamRepository.ts';
import { adminRepository } from '../repositories/adminRepository.ts';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      participant?: {
        id: string;
        name: string;
        participantCode: string;
        college?: string | null;
        email?: string | null;
        status: string;
      };
      team?: {
        id: string;
        teamName: string;
        teamCode: string;
        registeredMemberCount: number;
        status: string;
      };
      sessionRecord?: {
        id: string;
        teamId: string;
        participantId: string | null;
        sessionTokenHash: string;
        status: string;
        connectedAt: Date;
        lastHeartbeatAt: Date;
      };
      adminUser?: {
        id: string;
        username: string;
        displayName?: string;
        role: 'ADMIN' | 'SUPER_ADMIN';
      };
      adminSession?: any;
    }
  }
}

/**
 * Extracts participant session token from HTTP-only cookie or Authorization header
 */
export function extractToken(req: Request): string | null {
  if (req.cookies && req.cookies.bugrip_session) {
    return req.cookies.bugrip_session;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const xSessionToken = req.headers['x-session-token'];
  if (typeof xSessionToken === 'string' && xSessionToken.trim().length > 0) {
    return xSessionToken.trim();
  }
  if (req.query && typeof req.query.token === 'string') {
    return req.query.token;
  }
  if (req.body && typeof req.body.token === 'string') {
    return req.body.token;
  }
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      if (typeof parsed.token === 'string') {
        return parsed.token;
      }
    } catch {}
  }
  return null;
}

/**
 * Extracts admin session token from HTTP-only cookie or Authorization header
 */
export function extractAdminToken(req: Request): string | null {
  if (req.cookies && req.cookies.bugrip_admin_session) {
    return req.cookies.bugrip_admin_session;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const xAdminToken = req.headers['x-admin-token'];
  if (typeof xAdminToken === 'string' && xAdminToken.trim().length > 0) {
    return xAdminToken.trim();
  }
  if (req.query && typeof req.query.token === 'string') {
    return req.query.token;
  }
  if (req.body && typeof req.body.token === 'string') {
    return req.body.token;
  }
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      if (typeof parsed.token === 'string') {
        return parsed.token;
      }
    } catch {}
  }
  return null;
}

/**
 * Protects participant endpoints: validates session and derives authenticated team
 */
export async function requireParticipantAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const rawToken = extractToken(req);
    if (!rawToken) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. No participant session found.',
        code: 'UNAUTHENTICATED',
      });
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const sessionData = await teamRepository.findSessionByTokenHash(tokenHash);

    if (!sessionData) {
      // Clear invalid cookie if present
      res.clearCookie('bugrip_session', { path: '/' });
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired participant session.',
        code: 'SESSION_INVALID',
      });
    }

    const { team, session, participant } = sessionData as any;

    const participantStatus = participant?.status || team?.status || 'ACTIVE';
    if (participantStatus !== 'ACTIVE') {
      res.clearCookie('bugrip_session', { path: '/' });
      return res.status(403).json({
        success: false,
        error: 'Participant registration is inactive.',
        code: 'PARTICIPANT_INACTIVE',
      });
    }

    // Attach verified server-derived participant
    const resolvedParticipant = participant || {
      id: team.id,
      name: team.teamName,
      participantCode: team.teamCode,
      college: null,
      email: null,
      status: participantStatus,
    };

    req.participant = {
      id: resolvedParticipant.id,
      name: resolvedParticipant.name,
      participantCode: resolvedParticipant.participantCode || team.teamCode,
      college: resolvedParticipant.college || null,
      email: resolvedParticipant.email || null,
      status: resolvedParticipant.status || 'ACTIVE',
    };

    // Attach backward-compatible team object mapped directly to this individual participant
    req.team = {
      id: resolvedParticipant.id,
      teamName: resolvedParticipant.name,
      teamCode: resolvedParticipant.participantCode || team.teamCode,
      registeredMemberCount: 1,
      status: resolvedParticipant.status || 'ACTIVE',
    };
    req.sessionRecord = session;

    // Update heartbeat asynchronously
    teamRepository.updateSessionHeartbeat(session.id).catch(() => {});

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Admin authorization middleware:
 * 1. Strictly rejects participant tokens with a 403 Forbidden
 * 2. Validates admin session against database (or internal admin key)
 * 3. Derives verified admin user object on the server
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // 1. Participant barrier: If a participant token was passed, immediately reject
    const participantToken = extractToken(req);
    if (participantToken) {
      const tokenHash = crypto.createHash('sha256').update(participantToken).digest('hex');
      const isParticipant = await teamRepository.findSessionByTokenHash(tokenHash);
      if (isParticipant) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Participant tokens cannot access admin endpoints.',
          code: 'FORBIDDEN_ADMIN_ACCESS',
        });
      }
    }

    // 2. Extract admin session token
    const adminToken = extractAdminToken(req);
    if (adminToken) {
      const sessionData = await adminRepository.validateAdminSession(adminToken);
      if (sessionData && sessionData.adminUser.isActive) {
        req.adminUser = sessionData.adminUser;
        req.adminSession = sessionData;
        return next();
      }
    }

    // 3. Optional internal development key fallback (for automated headless test runs)
    const adminHeader = req.headers['x-admin-key'];
    if (
      adminHeader &&
      adminHeader === (process.env.ADMIN_SECRET_KEY || 'bugrip-superadmin-secret-2026')
    ) {
      req.adminUser = {
        id: '00000000-0000-0000-0000-000000000001',
        username: 'admin',
        displayName: 'Tournament Director',
        role: 'SUPER_ADMIN',
      };
      return next();
    }

    return res.status(401).json({
      success: false,
      error: 'Admin authentication required.',
      code: 'ADMIN_UNAUTHORIZED',
    });
  } catch (err) {
    next(err);
  }
}

// Backward compatibility alias
export const requireAdminAuth = requireAdmin;

/**
 * Super Admin authorization middleware:
 * Requires SUPER_ADMIN role privilege.
 */
export async function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  requireAdmin(req, res, (err) => {
    if (err) return next(err);
    if (req.adminUser?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Requires SUPER_ADMIN privilege.',
        code: 'SUPER_ADMIN_REQUIRED',
      });
    }
    next();
  });
}

