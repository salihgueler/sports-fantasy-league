/**
 * @fantasy/scoring — Scoring Engine public API.
 */
export { computePlayerPoints } from './compute-player-points.js';
export type { ScoredPlayer, StatPoints } from './compute-player-points.js';

export { computeTeamGameweekScore } from './compute-team-score.js';
export type {
  ActiveChips,
  PlayerScoreEntry,
  TeamGameweekScoreResult,
} from './compute-team-score.js';

export { persistGameweekScore } from './score-persistence.js';
export type { PersistScoreInput, PersistScoreResult } from './score-persistence.js';

export { handler as scoringHandler } from './handler.js';
export type { ScoreEvent, ScoreHandlerResult } from './handler.js';
