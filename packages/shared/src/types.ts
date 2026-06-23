/**
 * Core domain types for the Multi-Sport Fantasy League Engine.
 * These types are shared across all services and the frontend.
 */

// ─── Enums & Unions ─────────────────────────────────────────────────────────

export type CompetitionStatus = 'draft' | 'upcoming' | 'active' | 'completed';
export type Sport = 'football' | 'basketball' | 'baseball' | 'cricket';
export type ChipType = 'WILDCARD' | 'TRIPLE_CAPTAIN' | 'BENCH_BOOST' | 'FREE_HIT';
export type ScoreStatus = 'PROVISIONAL' | 'CONFIRMED';
export type CompetitionFormat = 'tournament' | 'league' | 'playoffs';
export type GameweekStatus = 'upcoming' | 'live' | 'finalized';
export type LeagueType = 'classic' | 'h2h';

// ─── Theme ──────────────────────────────────────────────────────────────────

export interface ThemeTokens {
  colorPrimary: string;
  colorAccent1: string;
  colorAccent2?: string;
  colorBackground?: string;
  colorSurface?: string;
  colorText?: string;
}

// ─── Competition & Roster ───────────────────────────────────────────────────

export interface Position {
  name: string;
  min: number;
  max: number;
}

export interface RosterConfig {
  positions: Position[];
  squadSize: number;
  startingXI: number;
  budget: number;
  captainMultiplier: number;
  perTeamCap: number;
}

export interface TransferRules {
  freeTransfersPerGameweek: number;
  carryOverLimit: number;
  penaltyPointsPerExtra: number;
  tripleCaptainMultiplier: number;
}

export interface Gameweek {
  gameweek: number;
  transferDeadline: string;
  status: GameweekStatus;
}

export interface Competition {
  competitionId: string;
  sport: Sport;
  name: string;
  format: CompetitionFormat;
  scoringRulesetId: string;
  rosterConfig: RosterConfig;
  transferRules: TransferRules;
  schedule: { gameweeks: Gameweek[] };
  chips: ChipType[];
  status: CompetitionStatus;
  dataProviderId: string;
  theme?: ThemeTokens;
}

// ─── Scoring ────────────────────────────────────────────────────────────────

export interface ScoringRule {
  stat: string;
  position?: string;
  points: number;
  conditions?: { min?: number; perEvery?: number };
}

export interface ScoringRuleset {
  rulesetId: string;
  sport: Sport;
  competitionId?: string;
  rules: ScoringRule[];
}

// ─── Fantasy Team ───────────────────────────────────────────────────────────

export interface SquadSlot {
  playerId: string;
  isCaptain: boolean;
  isViceCaptain: boolean;
  isBenched: boolean;
  benchPriority?: number;
}

export interface FantasyTeam {
  fantasyTeamId: string;
  userId: string;
  leagueId: string;
  competitionId: string;
  name: string;
  squad: SquadSlot[];
  formation: string;
  budget: number;
  freeTransfers: number;
  totalPoints: number;
}

// ─── Match Stats & Scores ───────────────────────────────────────────────────

export interface PlayerMatchStats {
  playerId: string;
  fixtureId: string;
  minutesPlayed: number;
  stats: Record<string, number>;
}

export interface TeamGameweekScore {
  fantasyTeamId: string;
  gameweek: number;
  points: number;
  scoreStatus: ScoreStatus;
}

// ─── Player ─────────────────────────────────────────────────────────────────

export interface Player {
  playerId: string;
  name: string;
  position: string;
  realTeamId: string;
  competitionId: string;
  price: number;
  totalPoints: number;
  availability: 'available' | 'injured' | 'suspended' | 'doubtful' | 'unavailable';
}

// ─── League ─────────────────────────────────────────────────────────────────

export interface League {
  leagueId: string;
  name: string;
  competitionId: string;
  type: LeagueType;
  maxMembers: number;
  joinCode: string;
  isPublic: boolean;
}

export interface LeagueInput {
  name: string;
  competitionId: string;
  type: LeagueType;
  maxMembers: number;
  isPublic: boolean;
}

export interface StandingsEntry {
  fantasyTeamId: string;
  teamName: string;
  userId: string;
  rank: number;
  totalPoints: number;
  gameweekPoints: number;
}

export interface ChatMessage {
  messageId: string;
  leagueId: string;
  userId: string;
  body: string;
  createdAt: string;
}

// ─── User ───────────────────────────────────────────────────────────────────

export interface NotificationPrefs {
  deadlineReminder: boolean;
  scoreUpdates: boolean;
  leagueChat: boolean;
  transferNews: boolean;
}

export interface UserProfile {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  notificationPrefs: NotificationPrefs;
  createdAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ─── API Response Wrappers ──────────────────────────────────────────────────

export interface ApiMeta {
  requestId: string;
  timestamp: string; // UTC ISO-8601
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta: ApiMeta;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
