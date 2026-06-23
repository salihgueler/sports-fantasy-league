/**
 * Key builder helpers for the single-table DynamoDB design.
 * Each function returns the PK/SK (and optional GSI keys) for an entity.
 */

import type { ChipType } from '../types.js';

// ─── Base key record type ───────────────────────────────────────────────────

export interface KeySet {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
}

// ─── User Profile ───────────────────────────────────────────────────────────

export function buildUserProfileKey(userId: string): KeySet {
  return {
    PK: `USER#${userId}`,
    SK: 'PROFILE',
  };
}

// ─── Competition ────────────────────────────────────────────────────────────

export interface CompetitionKeyParams {
  compId: string;
  status: string;
  startTs: string;
  endTs?: string;
}

export function buildCompetitionKey(params: CompetitionKeyParams): KeySet {
  const { compId, status, startTs, endTs } = params;
  return {
    PK: `COMPETITION#${compId}`,
    SK: 'META',
    GSI1PK: `COMP_STATUS#${status}`,
    GSI1SK: `START#${startTs}`,
    GSI2PK: `COMP_STATUS#${status}`,
    GSI2SK: `END#${endTs ?? startTs}`,
  };
}

// ─── Scoring Ruleset ────────────────────────────────────────────────────────

export function buildScoringRulesetKey(rulesetId: string): KeySet {
  return {
    PK: `RULESET#${rulesetId}`,
    SK: 'META',
  };
}

// ─── Data Provider Adapter ──────────────────────────────────────────────────

export function buildAdapterKey(adapterId: string): KeySet {
  return {
    PK: `ADAPTER#${adapterId}`,
    SK: 'META',
  };
}

// ─── Player ─────────────────────────────────────────────────────────────────

export interface PlayerKeyParams {
  compId: string;
  playerId: string;
  realTeamId: string;
  position: string;
  price: number;
  totalPoints: number;
}

export function buildPlayerKey(params: PlayerKeyParams): KeySet {
  const { compId, playerId, realTeamId, position, price, totalPoints } = params;
  return {
    PK: `COMPETITION#${compId}`,
    SK: `PLAYER#${playerId}`,
    GSI1PK: `COMP_TEAM#${compId}#${realTeamId}`,
    GSI1SK: `POS#${position}#PRICE#${String(price).padStart(10, '0')}`,
    GSI2PK: `COMP#${compId}`,
    GSI2SK: `POINTS#${String(totalPoints).padStart(10, '0')}`,
  };
}

// ─── Fixture ────────────────────────────────────────────────────────────────

export interface FixtureKeyParams {
  compId: string;
  gameweek: number;
  fixtureId: string;
  kickoffTs: string;
}

export function buildFixtureKey(params: FixtureKeyParams): KeySet {
  const { compId, gameweek, fixtureId, kickoffTs } = params;
  const gw = String(gameweek).padStart(3, '0');
  return {
    PK: `COMPETITION#${compId}`,
    SK: `FIXTURE#${gw}#${fixtureId}`,
    GSI1PK: `COMP_GW#${compId}#${gw}`,
    GSI1SK: `KICKOFF#${kickoffTs}`,
  };
}

// ─── Fantasy Team ───────────────────────────────────────────────────────────

export interface FantasyTeamKeyParams {
  userId: string;
  compId: string;
  leagueId: string;
  totalPoints: number;
}

export function buildFantasyTeamKey(params: FantasyTeamKeyParams): KeySet {
  const { userId, compId, leagueId, totalPoints } = params;
  return {
    PK: `USER#${userId}`,
    SK: `TEAM#${compId}#${leagueId}`,
    GSI1PK: `LEAGUE#${leagueId}`,
    GSI1SK: `POINTS#${String(totalPoints).padStart(10, '0')}`,
    GSI2PK: `COMP#${compId}`,
    GSI2SK: `USER#${userId}`,
  };
}

// ─── Gameweek Score ─────────────────────────────────────────────────────────

export interface GameweekScoreKeyParams {
  fantasyTeamId: string;
  gameweek: number;
  compId: string;
  points: number;
}

export function buildGameweekScoreKey(params: GameweekScoreKeyParams): KeySet {
  const { fantasyTeamId, gameweek, compId, points } = params;
  const gw = String(gameweek).padStart(3, '0');
  return {
    PK: `TEAM#${fantasyTeamId}`,
    SK: `GWSCORE#${gw}`,
    GSI1PK: `COMP_GW#${compId}#${gw}`,
    GSI1SK: `SCORE#${String(points).padStart(10, '0')}`,
  };
}

// ─── League ─────────────────────────────────────────────────────────────────

export interface LeagueKeyParams {
  leagueId: string;
  compId: string;
  joinCode: string;
}

export function buildLeagueKey(params: LeagueKeyParams): KeySet {
  const { leagueId, compId, joinCode } = params;
  return {
    PK: `LEAGUE#${leagueId}`,
    SK: 'META',
    GSI1PK: `COMP#${compId}`,
    GSI1SK: `LEAGUE#${leagueId}`,
    GSI2PK: `JOINCODE#${joinCode}`,
    GSI2SK: 'LEAGUE',
  };
}

// ─── League Membership ──────────────────────────────────────────────────────

export interface LeagueMembershipKeyParams {
  leagueId: string;
  fantasyTeamId: string;
  userId: string;
}

export function buildLeagueMembershipKey(params: LeagueMembershipKeyParams): KeySet {
  const { leagueId, fantasyTeamId, userId } = params;
  return {
    PK: `LEAGUE#${leagueId}`,
    SK: `MEMBER#${fantasyTeamId}`,
    GSI1PK: `USER#${userId}`,
    GSI1SK: `LEAGUE#${leagueId}`,
  };
}

// ─── H2H Fixture ────────────────────────────────────────────────────────────

export interface H2HFixtureKeyParams {
  leagueId: string;
  round: number;
  pairId: string;
}

export function buildH2HFixtureKey(params: H2HFixtureKeyParams): KeySet {
  const { leagueId, round, pairId } = params;
  const roundStr = String(round).padStart(3, '0');
  return {
    PK: `LEAGUE#${leagueId}`,
    SK: `H2H#${roundStr}#${pairId}`,
  };
}

// ─── Chat Message ───────────────────────────────────────────────────────────

export interface ChatMessageKeyParams {
  leagueId: string;
  createdTs: string;
  msgId: string;
}

export function buildChatMessageKey(params: ChatMessageKeyParams): KeySet {
  const { leagueId, createdTs, msgId } = params;
  return {
    PK: `LEAGUE#${leagueId}`,
    SK: `MSG#${createdTs}#${msgId}`,
  };
}

// ─── Chip State ─────────────────────────────────────────────────────────────

export function buildChipStateKey(fantasyTeamId: string, chipType: ChipType): KeySet {
  return {
    PK: `TEAM#${fantasyTeamId}`,
    SK: `CHIP#${chipType}`,
  };
}

// ─── WebSocket Connection ───────────────────────────────────────────────────

export interface WsConnectionKeyParams {
  connectionId: string;
  compId: string;
}

export function buildWsConnectionKey(params: WsConnectionKeyParams): KeySet {
  const { connectionId, compId } = params;
  return {
    PK: `CONN#${connectionId}`,
    SK: 'META',
    GSI1PK: `COMP_SUB#${compId}`,
    GSI1SK: `CONN#${connectionId}`,
  };
}
