/**
 * BUG RIP - Frontend Shared Types
 */

export interface SystemHealthData {
  status: string;
  system: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  services: {
    api: string;
    database?: string;
    rulesEngine: string;
    configuration: string;
  };
  database?: {
    connected: boolean;
    mode?: 'EMBEDDED_PGLITE' | 'EXTERNAL_POSTGRES' | 'CLOUD_SQL';
    engine: string;
    isEmbedded?: boolean;
    databaseUrlConfigured?: boolean;
    latencyMs?: number;
    error?: string;
  };
}

export interface CompetitionStatusData {
  eventState: 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED';
  remainingSeconds: number;
  totalSeconds: number;
  durationMinutes: number;
  isAuthoritative: boolean;
}

export type ThemeId = 'cyber-obsidian' | 'titanium-industrial' | 'midnight-arena' | 'paper-lab';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tagline: string;
  description: string;
  vibe: string;
  bestFor: string;
  bgClass: string;
  cardBg: string;
  borderClass: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentClass: string;
  accentBadge: string;
  fontDisplay: string;
  swatches: {
    label: string;
    hex: string;
    role: string;
  }[];
}

export type ActiveView = 'participant' | 'admin' | 'live' | 'foundation';

export type ActiveFoundationTab = 'rules' | 'tiebreaker' | 'architecture' | 'areas';

export type ActiveTab = ActiveFoundationTab;

export interface PublicLeaderboardEntry {
  rank: number;
  teamName: string;
  participantName?: string;
  connectedMembers: number;
  registeredMembers: number;
  problemsSolved: number;
  score: number;
  lastSolveTimestamp: string;
}

