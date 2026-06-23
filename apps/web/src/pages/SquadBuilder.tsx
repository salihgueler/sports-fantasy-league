import { useState, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type {
  Competition,
  FantasyTeam,
  Player,
  SquadSlot as SquadSlotType,
  Position,
} from '@fantasy/shared';
import { useApiQuery, useApiMutation } from '../hooks/use-api';
import { SquadSlot } from '../components/SquadSlot';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { cn } from '../lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AutoPickResponse {
  squad: SquadSlotType[];
  remainingBudget: number;
}

interface CaptaincyResponse {
  captainId: string;
  viceCaptainId: string;
}

interface FormationResponse {
  formation: string;
}

interface SquadSubmitResponse {
  remainingBudget: number;
}

const selectClass = cn(
  'flex h-9 items-center rounded-md border border-input bg-card px-3 text-sm',
  'ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
);

// ─── Helpers ────────────────────────────────────────────────────────────────

function getPositionCounts(squad: SquadSlotType[], players: Player[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const slot of squad) {
    const player = players.find((p) => p.playerId === slot.playerId);
    if (player) {
      counts[player.position] = (counts[player.position] ?? 0) + 1;
    }
  }
  return counts;
}

function getTeamCounts(squad: SquadSlotType[], players: Player[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const slot of squad) {
    const player = players.find((p) => p.playerId === slot.playerId);
    if (player) {
      counts[player.realTeamId] = (counts[player.realTeamId] ?? 0) + 1;
    }
  }
  return counts;
}

function getSpentBudget(squad: SquadSlotType[], players: Player[]): number {
  let spent = 0;
  for (const slot of squad) {
    const player = players.find((p) => p.playerId === slot.playerId);
    if (player) spent += player.price;
  }
  return spent;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SquadBuilder() {
  const { fantasyTeamId } = useParams<{ fantasyTeamId: string }>();
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const [formationInput, setFormationInput] = useState('');

  // Local draft of the squad while the user builds it. `null` means "use the
  // server squad as-is" (no unsaved edits). Add/remove operate on this draft;
  // it is persisted only when the user saves a complete squad.
  const [draftSquad, setDraftSquad] = useState<SquadSlotType[] | null>(null);

  // Player pool filters
  const [poolPosition, setPoolPosition] = useState('');
  const [poolSearch, setPoolSearch] = useState('');

  // ─── Queries ────────────────────────────────────────────────────────────

  const {
    data: team,
    isLoading: teamLoading,
    error: teamError,
  } = useApiQuery<{ fantasyTeam: FantasyTeam }, FantasyTeam>(
    ['fantasyTeam', fantasyTeamId],
    `/teams/${fantasyTeamId}`,
    { enabled: !!fantasyTeamId, select: (d) => d.fantasyTeam },
  );

  const competitionId = team?.competitionId;

  const { data: competition, isLoading: competitionLoading } = useApiQuery<
    { competition: Competition },
    Competition
  >(['competition', competitionId], `/competitions/${competitionId}`, {
    enabled: !!competitionId,
    select: (d) => d.competition,
  });

  const { data: players } = useApiQuery<{ players: Player[] }, Player[]>(
    ['playerPool', competitionId],
    `/competitions/${competitionId}/players`,
    {
      enabled: !!competitionId,
      select: (d) => d.players.filter((p) => typeof p.price === 'number'),
    },
  );

  // ─── Mutations ──────────────────────────────────────────────────────────

  const autoPickMutation = useApiMutation<AutoPickResponse>(
    `/teams/${fantasyTeamId}/auto-pick`,
    'POST',
    {
      onSuccess: () => {
        setDraftSquad(null); // discard local edits, show the server-filled squad
        queryClient.invalidateQueries({ queryKey: ['fantasyTeam', fantasyTeamId] });
        setError(null);
      },
      onError: (err) => setError(err.message),
    },
  );

  const captaincyMutation = useApiMutation<
    CaptaincyResponse,
    { captainId: string; viceCaptainId: string }
  >(`/teams/${fantasyTeamId}/captaincy`, 'PUT', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fantasyTeam', fantasyTeamId] });
      setError(null);
    },
    onError: (err) => setError(err.message),
  });

  const formationMutation = useApiMutation<FormationResponse, { formation: string }>(
    `/teams/${fantasyTeamId}/formation`,
    'PUT',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['fantasyTeam', fantasyTeamId] });
        setError(null);
      },
      onError: (err) => setError(err.message),
    },
  );

  const submitSquadMutation = useApiMutation<SquadSubmitResponse, { squad: SquadSlotType[] }>(
    `/teams/${fantasyTeamId}/squad`,
    'PUT',
    {
      onSuccess: () => {
        setDraftSquad(null); // saved — resync to the server squad
        queryClient.invalidateQueries({ queryKey: ['fantasyTeam', fantasyTeamId] });
        setError(null);
      },
      onError: (err) => setError(err.message),
    },
  );

  // ─── Derived state ─────────────────────────────────────────────────────

  const allPlayers = useMemo(() => players ?? [], [players]);
  // The squad currently shown: local draft if the user has edits, else server.
  const squad = draftSquad ?? team?.squad ?? [];
  const hasUnsavedChanges = draftSquad !== null;

  const positionCounts = useMemo(() => getPositionCounts(squad, allPlayers), [squad, allPlayers]);
  const teamCounts = useMemo(() => getTeamCounts(squad, allPlayers), [squad, allPlayers]);
  const spentBudget = useMemo(() => getSpentBudget(squad, allPlayers), [squad, allPlayers]);

  const budget = competition?.rosterConfig.budget ?? 0;
  const squadSize = competition?.rosterConfig.squadSize ?? 0;
  const perTeamCap = competition?.rosterConfig.perTeamCap ?? Infinity;
  const remainingBudget = budget - spentBudget;
  const isComplete = squad.length === squadSize;

  const pickedIds = useMemo(() => new Set(squad.map((s) => s.playerId)), [squad]);

  const positionMax = useCallback(
    (positionName: string): number =>
      competition?.rosterConfig.positions.find((p: Position) => p.name === positionName)?.max ?? 0,
    [competition],
  );

  // Why a given player can't be added right now (null = can add).
  const addBlockReason = useCallback(
    (player: Player): string | null => {
      if (pickedIds.has(player.playerId)) return 'Already picked';
      if (squad.length >= squadSize) return 'Squad full';
      if ((positionCounts[player.position] ?? 0) >= positionMax(player.position))
        return `${player.position} full`;
      if ((teamCounts[player.realTeamId] ?? 0) >= perTeamCap) return 'Team cap reached';
      if (spentBudget + player.price > budget) return 'Over budget';
      return null;
    },
    [
      pickedIds,
      squad.length,
      squadSize,
      positionCounts,
      positionMax,
      teamCounts,
      perTeamCap,
      spentBudget,
      budget,
    ],
  );

  // Group squad by position for display
  const squadByPosition = useMemo(() => {
    if (!competition) return [];
    return competition.rosterConfig.positions.map((pos: Position) => {
      const posPlayers = squad.filter((slot) => {
        const p = allPlayers.find((pl) => pl.playerId === slot.playerId);
        return p?.position === pos.name;
      });
      return { position: pos, slots: posPlayers };
    });
  }, [competition, squad, allPlayers]);

  // Filtered, sorted player pool for the picker
  const filteredPool = useMemo(() => {
    const search = poolSearch.trim().toLowerCase();
    return allPlayers
      .filter((p) => (poolPosition ? p.position === poolPosition : true))
      .filter((p) => (search ? p.name.toLowerCase().includes(search) : true))
      .sort((a, b) => b.totalPoints - a.totalPoints || a.price - b.price);
  }, [allPlayers, poolPosition, poolSearch]);

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handleAddPlayer = useCallback(
    (player: Player) => {
      if (addBlockReason(player)) return;
      const next: SquadSlotType[] = [
        ...squad,
        { playerId: player.playerId, isCaptain: false, isViceCaptain: false, isBenched: false },
      ];
      setDraftSquad(next);
      setError(null);
    },
    [squad, addBlockReason],
  );

  const handleRemovePlayer = useCallback(
    (playerId: string) => {
      setDraftSquad(squad.filter((s) => s.playerId !== playerId));
      setError(null);
    },
    [squad],
  );

  const handleSetCaptain = useCallback(
    (playerId: string) => {
      if (hasUnsavedChanges) {
        setError('Save your squad before setting a captain.');
        return;
      }
      const currentVc = squad.find((s) => s.isViceCaptain);
      const viceCaptainId = currentVc?.playerId ?? '';
      if (!viceCaptainId || viceCaptainId === playerId) {
        setError('Please select a different vice-captain first.');
        return;
      }
      captaincyMutation.mutate({ captainId: playerId, viceCaptainId });
    },
    [squad, hasUnsavedChanges, captaincyMutation],
  );

  const handleSetViceCaptain = useCallback(
    (playerId: string) => {
      if (hasUnsavedChanges) {
        setError('Save your squad before setting a vice-captain.');
        return;
      }
      const currentCpt = squad.find((s) => s.isCaptain);
      const captainId = currentCpt?.playerId ?? '';
      if (!captainId || captainId === playerId) {
        setError('Please select a different captain first.');
        return;
      }
      captaincyMutation.mutate({ captainId, viceCaptainId: playerId });
    },
    [squad, hasUnsavedChanges, captaincyMutation],
  );

  const handleAutoPick = useCallback(() => {
    setError(null);
    autoPickMutation.mutate(undefined as unknown as void);
  }, [autoPickMutation]);

  const handleSaveSquad = useCallback(() => {
    setError(null);
    submitSquadMutation.mutate({ squad });
  }, [squad, submitSquadMutation]);

  const handleFormationSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!formationInput.trim()) {
        setError('Please enter a formation (e.g., 4-4-2).');
        return;
      }
      setError(null);
      formationMutation.mutate({ formation: formationInput.trim() });
    },
    [formationInput, formationMutation],
  );

  // ─── Loading / Error States ─────────────────────────────────────────────

  if (!fantasyTeamId) {
    return <p className="text-destructive">No team selected.</p>;
  }

  if (teamLoading || competitionLoading) {
    return <p className="text-muted-foreground">Loading squad...</p>;
  }

  if (teamError) {
    return <p className="text-destructive">Failed to load team: {teamError.message}</p>;
  }

  if (!team || !competition) {
    return <p className="text-destructive">Team or competition not found.</p>;
  }

  const positionNames = competition.rosterConfig.positions.map((p: Position) => p.name);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">Squad Builder</h2>
        {hasUnsavedChanges && <Badge variant="destructive">Unsaved changes</Badge>}
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Live feedback bar */}
      <Card>
        <CardContent aria-label="Squad status" className="flex flex-wrap gap-4 py-3 text-sm">
          <div>
            <span className="text-muted-foreground">Budget:</span>{' '}
            <span
              className={cn(
                'font-mono font-medium tabular-nums',
                remainingBudget < 0 ? 'text-destructive' : 'text-foreground',
              )}
            >
              {remainingBudget.toFixed(1)} remaining
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Squad:</span>{' '}
            <span
              className={cn(
                'font-mono font-medium tabular-nums',
                isComplete ? 'text-success' : 'text-foreground',
              )}
            >
              {squad.length}/{squadSize}
            </span>
          </div>
          {competition.rosterConfig.positions.map((pos: Position) => (
            <div key={pos.name}>
              <span className="text-muted-foreground">{pos.name}:</span>{' '}
              <span
                className={cn(
                  'font-mono font-medium tabular-nums',
                  (positionCounts[pos.name] ?? 0) > pos.max ||
                    (positionCounts[pos.name] ?? 0) < pos.min
                    ? 'text-destructive'
                    : 'text-foreground',
                )}
              >
                {positionCounts[pos.name] ?? 0}/{pos.min}-{pos.max}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Per-team cap usage */}
      {Object.keys(teamCounts).length > 0 && (
        <section aria-label="Per-team usage" className="text-xs text-muted-foreground">
          <span className="font-medium">Per-team cap ({competition.rosterConfig.perTeamCap}):</span>{' '}
          {Object.entries(teamCounts)
            .sort(([, a], [, b]) => b - a)
            .map(([teamId, count]) => (
              <span
                key={teamId}
                className={cn(
                  'mr-2 font-mono tabular-nums',
                  count >= competition.rosterConfig.perTeamCap && 'font-medium text-destructive',
                )}
              >
                {teamId}: {count}
              </span>
            ))}
        </section>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left: Squad slots by position */}
        <section className="min-w-0 flex-1" aria-label="Squad composition">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Your Squad</h3>
          {squadByPosition.map(({ position, slots }) => (
            <div key={position.name} className="mb-4">
              <h4 className="mb-2 text-sm font-semibold text-muted-foreground">
                {position.name}{' '}
                <span className="font-mono tabular-nums">
                  ({slots.length}/{position.max})
                </span>
              </h4>
              <div className="flex flex-col gap-1">
                {slots.map((slot) => {
                  const player = allPlayers.find((p) => p.playerId === slot.playerId);
                  return (
                    <SquadSlot
                      key={slot.playerId}
                      slot={slot}
                      player={player}
                      positionName={position.name}
                      onRemove={handleRemovePlayer}
                      onSetCaptain={handleSetCaptain}
                      onSetViceCaptain={handleSetViceCaptain}
                    />
                  );
                })}
                {/* Show empty slots up to the minimum for this position */}
                {Array.from({ length: Math.max(0, position.min - slots.length) }, (_, i) => (
                  <SquadSlot
                    key={`empty-${position.name}-${i}`}
                    slot={null}
                    player={undefined}
                    positionName={position.name}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* Middle: Player pool picker */}
        <section className="min-w-0 flex-1" aria-label="Player pool">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Add Players</h3>

          <div className="mb-3 flex flex-wrap gap-2">
            <label htmlFor="pool-search" className="sr-only">
              Search players
            </label>
            <Input
              id="pool-search"
              type="text"
              value={poolSearch}
              onChange={(e) => setPoolSearch(e.target.value)}
              placeholder="Search by name…"
              className="h-9 flex-1"
            />
            <label htmlFor="pool-position" className="sr-only">
              Filter by position
            </label>
            <select
              id="pool-position"
              value={poolPosition}
              onChange={(e) => setPoolPosition(e.target.value)}
              className={selectClass}
            >
              <option value="">All positions</option>
              {positionNames.map((name: string) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="max-h-[28rem] overflow-y-auto rounded-lg border bg-card">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Player</TableHead>
                  <TableHead>Pos</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">£</TableHead>
                  <TableHead className="text-right">Pts</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPool.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="py-4 text-center text-muted-foreground">
                      No players match your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPool.map((player) => {
                    const reason = addBlockReason(player);
                    const picked = pickedIds.has(player.playerId);
                    return (
                      <TableRow key={player.playerId}>
                        <TableCell className="py-1.5 font-medium text-foreground">
                          {player.name}
                        </TableCell>
                        <TableCell className="py-1.5 text-muted-foreground">
                          {player.position}
                        </TableCell>
                        <TableCell className="py-1.5 text-muted-foreground">
                          {player.realTeamId}
                        </TableCell>
                        <TableCell className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                          {player.price.toFixed(1)}
                        </TableCell>
                        <TableCell className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                          {player.totalPoints}
                        </TableCell>
                        <TableCell className="py-1.5 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant={picked || reason ? 'ghost' : 'default'}
                            onClick={() => handleAddPlayer(player)}
                            disabled={!!reason}
                            title={reason ?? 'Add to squad'}
                            className="h-7 px-2 text-xs"
                            aria-label={`Add ${player.name} to squad`}
                          >
                            {picked ? 'Added' : reason ? reason : 'Add'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* Right: Actions panel */}
        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-72" aria-label="Squad actions">
          {/* Save */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Save Squad</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">
                Save once you have a full squad of {squadSize} within budget and position limits.
              </p>
              <Button
                type="button"
                variant="success"
                onClick={handleSaveSquad}
                disabled={submitSquadMutation.isPending || !isComplete}
                className="w-full"
                aria-label="Save squad"
              >
                {submitSquadMutation.isPending
                  ? 'Saving...'
                  : isComplete
                    ? 'Save Squad'
                    : `Save Squad (${squad.length}/${squadSize})`}
              </Button>
            </CardContent>
          </Card>

          {/* Auto-pick */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Auto-Pick</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">
                Fill remaining slots automatically within budget and position constraints. Replaces
                any unsaved changes.
              </p>
              <Button
                type="button"
                onClick={handleAutoPick}
                disabled={autoPickMutation.isPending}
                className="w-full"
                aria-label="Auto-pick remaining squad slots"
              >
                {autoPickMutation.isPending ? 'Picking...' : 'Auto-Pick'}
              </Button>
            </CardContent>
          </Card>

          {/* Formation */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Formation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-muted-foreground">
                Current:{' '}
                <span className="font-medium text-foreground">{team.formation || 'Not set'}</span>
              </p>
              <form onSubmit={handleFormationSubmit} className="flex gap-2">
                <Label htmlFor="formation-input" className="sr-only">
                  Formation
                </Label>
                <Input
                  id="formation-input"
                  type="text"
                  value={formationInput}
                  onChange={(e) => setFormationInput(e.target.value)}
                  placeholder="e.g. 4-4-2"
                  className="h-9 flex-1"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  disabled={formationMutation.isPending}
                >
                  {formationMutation.isPending ? 'Saving...' : 'Set'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
