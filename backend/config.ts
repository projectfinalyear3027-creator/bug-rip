/**
 * BUG RIP - Fragment 1 Configuration Management Module
 * 
 * Minimal, clean configuration foundation for Fragment 1.
 * Does NOT require PostgreSQL, Redis, Java Sandbox, JWT_SECRET, or ADMIN_API_KEY.
 * All runtime service configurations are deferred to their respective implementation fragments.
 */

export interface SystemConfig {
  server: {
    port: number;
    host: string;
    nodeEnv: string;
    isProduction: boolean;
  };
  competition: {
    durationMinutes: number;
    minTeamMembers: number;
    maxTeamMembers: number;
  };
  queue: {
    executionQueueName: string;
  };
}

export function loadConfig(): SystemConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  return {
    server: {
      port: parseInt(process.env.PORT || '3000', 10),
      host: '0.0.0.0',
      nodeEnv,
      isProduction,
    },
    competition: {
      durationMinutes: parseInt(process.env.COMPETITION_DURATION_MINUTES || '60', 10),
      minTeamMembers: parseInt(process.env.MIN_TEAM_MEMBERS || '1', 10),
      maxTeamMembers: parseInt(process.env.MAX_TEAM_MEMBERS || '1', 10),
    },
    queue: {
      executionQueueName: process.env.EXECUTION_QUEUE_NAME || 'java-execution',
    },
  };
}

export const config = loadConfig();
