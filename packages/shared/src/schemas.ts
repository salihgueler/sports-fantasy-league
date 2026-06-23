/**
 * Zod schemas for API request bodies.
 * These schemas are shared between frontend (form validation) and backend (request parsing).
 */
import { z } from 'zod';

// ─── Auth Schemas ───────────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(50),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type SignInInput = z.infer<typeof SignInSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof RefreshSchema>;

export const VerifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().min(1).max(10),
});
export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;

// ─── User Profile Schemas ───────────────────────────────────────────────────

export const UpdateDisplayNameSchema = z.object({
  displayName: z.string().min(1).max(50),
});
export type UpdateDisplayNameInput = z.infer<typeof UpdateDisplayNameSchema>;

export const UpdateNotificationPrefsSchema = z.object({
  deadlineReminder: z.boolean(),
  scoreUpdates: z.boolean(),
  leagueChat: z.boolean(),
  transferNews: z.boolean(),
});
export type UpdateNotificationPrefsInput = z.infer<typeof UpdateNotificationPrefsSchema>;

// ─── Squad / Team Schemas ───────────────────────────────────────────────────

const SquadSlotSchema = z.object({
  playerId: z.string().min(1),
  isCaptain: z.boolean(),
  isViceCaptain: z.boolean(),
  isBenched: z.boolean(),
  benchPriority: z.number().int().min(1).optional(),
});

export const SubmitSquadSchema = z.object({
  competitionId: z.string().min(1),
  leagueId: z.string().min(1),
  teamName: z.string().min(1).max(50),
  squad: z.array(SquadSlotSchema).min(1),
  formation: z.string().min(1),
});
export type SubmitSquadInput = z.infer<typeof SubmitSquadSchema>;

export const CreateTeamSchema = z.object({
  competitionId: z.string().min(1),
  teamName: z.string().min(1).max(50),
});
export type CreateTeamInput = z.infer<typeof CreateTeamSchema>;

export const UpdateSquadSchema = z.object({
  squad: z.array(SquadSlotSchema).min(1),
});
export type UpdateSquadInput = z.infer<typeof UpdateSquadSchema>;

export const RenameTeamSchema = z.object({
  name: z.string().min(1).max(50),
});
export type RenameTeamInput = z.infer<typeof RenameTeamSchema>;

export const SetCaptaincySchema = z.object({
  fantasyTeamId: z.string().min(1),
  captainId: z.string().min(1),
  viceCaptainId: z.string().min(1),
});
export type SetCaptaincyInput = z.infer<typeof SetCaptaincySchema>;

export const SetFormationSchema = z.object({
  fantasyTeamId: z.string().min(1),
  formation: z.string().min(1),
  squad: z.array(SquadSlotSchema).min(1),
});
export type SetFormationInput = z.infer<typeof SetFormationSchema>;

// ─── Transfer Schemas ───────────────────────────────────────────────────────

export const SubmitTransferSchema = z.object({
  fantasyTeamId: z.string().min(1),
  playersIn: z.array(z.string().min(1)).min(1),
  playersOut: z.array(z.string().min(1)).min(1),
});
export type SubmitTransferInput = z.infer<typeof SubmitTransferSchema>;

// ─── Chip Schemas ───────────────────────────────────────────────────────────

export const ActivateChipSchema = z.object({
  fantasyTeamId: z.string().min(1),
  chipType: z.enum(['WILDCARD', 'TRIPLE_CAPTAIN', 'BENCH_BOOST', 'FREE_HIT']),
  gameweek: z.number().int().min(1),
});
export type ActivateChipInput = z.infer<typeof ActivateChipSchema>;

// ─── League Schemas ─────────────────────────────────────────────────────────

export const CreateLeagueSchema = z.object({
  name: z.string().min(1).max(100),
  competitionId: z.string().min(1),
  type: z.enum(['classic', 'h2h']),
  maxMembers: z.number().int().min(2).max(256),
  isPublic: z.boolean(),
});
export type CreateLeagueInput = z.infer<typeof CreateLeagueSchema>;

export const JoinByCodeSchema = z.object({
  joinCode: z.string().length(8),
});
export type JoinByCodeInput = z.infer<typeof JoinByCodeSchema>;

// ─── Chat Schemas ───────────────────────────────────────────────────────────

export const PostMessageSchema = z.object({
  leagueId: z.string().min(1),
  body: z.string().min(1).max(500),
});
export type PostMessageInput = z.infer<typeof PostMessageSchema>;

// ─── Competition Admin Schemas ──────────────────────────────────────────────

const PositionSchema = z.object({
  name: z.string().min(1),
  min: z.number().int().min(0),
  max: z.number().int().min(1),
});

const RosterConfigSchema = z.object({
  positions: z.array(PositionSchema).min(1),
  squadSize: z.number().int().min(1),
  startingXI: z.number().int().min(1),
  budget: z.number().positive(),
  captainMultiplier: z.number().int().min(1),
  perTeamCap: z.number().int().min(1),
});

const TransferRulesSchema = z.object({
  freeTransfersPerGameweek: z.number().int().min(0),
  carryOverLimit: z.number().int().min(0),
  penaltyPointsPerExtra: z.number().int().min(0),
  tripleCaptainMultiplier: z.number().int().min(1),
});

const GameweekSchema = z.object({
  gameweek: z.number().int().min(1),
  transferDeadline: z.string().datetime(),
  status: z.enum(['upcoming', 'live', 'finalized']),
});

const ThemeTokensSchema = z.object({
  colorPrimary: z.string().min(1),
  colorAccent1: z.string().min(1),
  colorAccent2: z.string().optional(),
  colorBackground: z.string().optional(),
  colorSurface: z.string().optional(),
  colorText: z.string().optional(),
});

export const CreateCompetitionSchema = z.object({
  sport: z.enum(['football', 'basketball', 'baseball', 'cricket']),
  name: z.string().min(1).max(150),
  format: z.enum(['tournament', 'league', 'playoffs']),
  scoringRulesetId: z.string().min(1),
  rosterConfig: RosterConfigSchema,
  transferRules: TransferRulesSchema,
  schedule: z.object({ gameweeks: z.array(GameweekSchema).min(1) }),
  chips: z.array(z.enum(['WILDCARD', 'TRIPLE_CAPTAIN', 'BENCH_BOOST', 'FREE_HIT'])),
  dataProviderId: z.string().min(1),
  theme: ThemeTokensSchema.optional(),
});
export type CreateCompetitionInput = z.infer<typeof CreateCompetitionSchema>;

// Re-export sub-schemas that consumers may need for partial validation
export {
  SquadSlotSchema,
  PositionSchema,
  RosterConfigSchema,
  TransferRulesSchema,
  GameweekSchema,
  ThemeTokensSchema,
};
