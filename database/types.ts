/**
 * BUG RIP - Database Entity Types
 * Maps PostgreSQL tables and views to TypeScript definitions.
 */

import { ChallengeDifficulty, EventState } from '../backend/types/competition';

export interface DbTeam {
  id: string;
  team_name: string;
  team_code: string;
  registered_member_count: 1 | 2 | 3;
  created_at: string;
  updated_at: string;
}

export interface DbParticipant {
  id: string;
  participant_id: string;
  team_id: string;
  name: string;
  email: string;
  college: string;
  created_at: string;
}

export interface DbTeamSession {
  id: string;
  team_id: string;
  participant_id?: string;
  session_token_hash: string;
  is_active: boolean;
  connected_at: string;
  last_heartbeat: string;
}

export interface DbChallenge {
  id: string;
  title: string;
  difficulty: ChallengeDifficulty;
  points: number;
  order_index: number;
  description: string;
  starter_code: string;
  flag_hash: string;
  verification_class: string;
  is_active: boolean;
  created_at: string;
}

export interface DbTeamSubmission {
  id: string;
  team_id: string;
  challenge_id: string;
  session_id?: string;
  participant_id?: string;
  submitted_flag: string;
  is_valid: boolean;
  is_first_solve: boolean;
  awarded_points: number;
  created_at: string;
}

export interface DbEventState {
  id: 1;
  state: EventState;
  started_at?: string;
  total_duration_seconds: number;
  paused_elapsed_seconds: number;
  ended_at?: string;
  updated_at: string;
}

export interface DbLeaderboardRow {
  team_id: string;
  team_name: string;
  registered_member_count: number;
  problems_solved: number;
  total_score: number;
  last_solve_timestamp: string;
}
