import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft } from 'lucide-react';
import type { ChipType, Competition, FantasyTeam, Gameweek, Player } from '@fantasy/shared';
import { useApiQuery, useApiMutation } from '../hooks/use-api';
import { ChipActivation } from '../components/ChipActivation';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { cn } from '../lib/utils';

interface ChipState {
  chipType: ChipType;
  remainingUses: number;
  isActive: boolean;
}

interface TransferResult {
  fantasyTeamId: string;
  freeTransfersRemaining: number;
  penaltyApplied: number;
}

const selectClass = cn(
  'mt-1 flex h-10 w-full items-center rounded-md border border-input bg-card px-3 py-2 text-sm',
  'ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export function Transfers() {
  const { fantasyTeamId } = useParams<{ fantasyTeamId: string }>();
  const queryClient = useQueryClient();

  const [playerOut, setPlayerOut] = useState('');
  const [playerIn, setPlayerIn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Fetch the fantasy team to get competitionId, free transfers, squad
  const {
    data: team,
    isLoading: teamLoading,
    error: teamError,
  } = useApiQuery<{ fantasyTeam: FantasyTeam }, FantasyTeam>(
    ['fantasyTeam', fantasyTeamId],
    `/teams/${fantasyTeamId}`,
    { enabled: !!fantasyTeamId, select: (d) => d.fantasyTeam },
  );

  // Fetch the competition to get transfer rules, schedule, and chips
  const {
    data: competition,
    isLoading: competitionLoading,
    error: competitionError,
  } = useApiQuery<{ competition: Competition }, Competition>(
    ['competition', team?.competitionId],
    `/competitions/${team?.competitionId}`,
    { enabled: !!team?.competitionId, select: (d) => d.competition },
  );

  // Determine the current gameweek (first upcoming or live)
  const currentGameweek: Gameweek | undefined = useMemo(() => {
    if (!competition) return undefined;
    const gws = competition.schedule.gameweeks;
    return gws.find((gw) => gw.status === 'live') ?? gws.find((gw) => gw.status === 'upcoming');
  }, [competition]);

  // Fetch gameweek state (deadline info) from the Gameweek Service
  const { data: gameweekState } = useApiQuery<{
    transferDeadline: string;
    gameweek: number;
  }>(
    ['gameweekState', team?.competitionId, currentGameweek?.gameweek],
    `/gameweeks/${team?.competitionId}/${currentGameweek?.gameweek}`,
    { enabled: !!team?.competitionId && !!currentGameweek },
  );

  // Fetch chip states
  const { data: chipStates } = useApiQuery<ChipState[]>(
    ['chipStates', fantasyTeamId],
    `/teams/${fantasyTeamId}/chips`,
    { enabled: !!fantasyTeamId },
  );

  // Fetch available players for the transfer in
  const { data: players } = useApiQuery<{ players: Player[] }, Player[]>(
    ['playerPool', team?.competitionId],
    `/competitions/${team?.competitionId}/players`,
    { enabled: !!team?.competitionId, select: (d) => d.players },
  );

  // Deadline state computation
  const isDeadlinePassed = useMemo(() => {
    if (!gameweekState) return false;
    return new Date(gameweekState.transferDeadline) <= new Date();
  }, [gameweekState]);

  // Countdown to deadline
  const deadlineDisplay = useMemo(() => {
    if (!gameweekState) return null;
    const deadline = new Date(gameweekState.transferDeadline);
    const now = new Date();
    if (deadline <= now) return 'Deadline passed';

    const diffMs = deadline.getTime() - now.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h remaining`;
    }
    return `${hours}h ${minutes}m remaining`;
  }, [gameweekState]);

  // Penalty preview
  const penaltyPreview = useMemo(() => {
    if (!team || !competition) return null;
    if (team.freeTransfers > 0) return null;
    return competition.transferRules.penaltyPointsPerExtra;
  }, [team, competition]);

  // Transfer mutation
  const transferMutation = useApiMutation<
    TransferResult,
    { fantasyTeamId: string; playersIn: string[]; playersOut: string[] }
  >('/transfers', 'POST', {
    onSuccess(data) {
      setError(null);
      setSuccess(
        `Transfer complete. ${data.freeTransfersRemaining} free transfer${data.freeTransfersRemaining !== 1 ? 's' : ''} remaining.` +
          (data.penaltyApplied > 0 ? ` ${data.penaltyApplied} point deduction applied.` : ''),
      );
      setPlayerOut('');
      setPlayerIn('');
      queryClient.invalidateQueries({ queryKey: ['fantasyTeam', fantasyTeamId] });
    },
    onError(err) {
      setSuccess(null);
      switch (err.code) {
        case 'TRANSFER_DEADLINE_PASSED':
          setError('The transfer deadline has passed. No changes allowed.');
          break;
        case 'BUDGET_EXCEEDED':
          setError('This transfer would exceed your budget.');
          break;
        case 'PLAYER_ALREADY_IN_SQUAD':
          setError('The selected player is already in your squad.');
          break;
        default:
          setError(err.message);
      }
    },
  });

  function handleSubmitTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!fantasyTeamId || !playerIn || !playerOut) return;
    setError(null);
    setSuccess(null);
    transferMutation.mutate({
      fantasyTeamId,
      playersIn: [playerIn],
      playersOut: [playerOut],
    });
  }

  // Get players in squad for "player out" dropdown
  const squadPlayers = useMemo(() => {
    if (!team || !players) return [];
    const squadIds = new Set(team.squad.map((s) => s.playerId));
    return players.filter((p) => squadIds.has(p.playerId));
  }, [team, players]);

  // Get players NOT in squad for "player in" dropdown
  const availablePlayers = useMemo(() => {
    if (!team || !players) return [];
    const squadIds = new Set(team.squad.map((s) => s.playerId));
    return players.filter((p) => !squadIds.has(p.playerId));
  }, [team, players]);

  if (!fantasyTeamId) {
    return <p className="text-destructive">No team selected.</p>;
  }

  if (teamLoading || competitionLoading) {
    return <p className="text-muted-foreground">Loading transfer data...</p>;
  }

  if (teamError) {
    return <p className="text-destructive">Failed to load team: {teamError.message}</p>;
  }

  if (competitionError) {
    return (
      <p className="text-destructive">Failed to load competition: {competitionError.message}</p>
    );
  }

  if (!team || !competition) {
    return <p className="text-destructive">Team or competition not found.</p>;
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Main: Transfer Form */}
      <section className="min-w-0 flex-1" aria-label="Transfers">
        <h2 className="mb-4 font-display text-xl font-semibold">Transfers</h2>

        {/* Deadline & Free Transfers Summary */}
        <Card className="mb-4">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-6 text-sm">
              <div>
                <span className="text-muted-foreground">Free Transfers:</span>{' '}
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {team.freeTransfers}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Gameweek:</span>{' '}
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {currentGameweek?.gameweek ?? '—'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Deadline:</span>{' '}
                <span
                  className={cn(
                    'font-semibold',
                    isDeadlinePassed ? 'text-destructive' : 'text-foreground',
                  )}
                >
                  {deadlineDisplay ?? '—'}
                </span>
              </div>
            </div>

            {penaltyPreview !== null && (
              <p
                className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 p-2 text-sm font-medium text-destructive"
                role="alert"
              >
                No free transfers remaining. Each additional transfer costs {penaltyPreview} point
                deduction.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Transfer Form */}
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmitTransfer} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {error}
                </div>
              )}

              {success && (
                <div
                  role="status"
                  className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success"
                >
                  {success}
                </div>
              )}

              <div>
                <Label htmlFor="player-out">Player Out</Label>
                <select
                  id="player-out"
                  value={playerOut}
                  onChange={(e) => setPlayerOut(e.target.value)}
                  required
                  disabled={isDeadlinePassed}
                  className={selectClass}
                >
                  <option value="">Select a player to remove</option>
                  {squadPlayers.map((p) => (
                    <option key={p.playerId} value={p.playerId}>
                      {p.name} — {p.position} ({p.realTeamId}) — ${p.price}m
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-center text-muted-foreground">
                <ArrowRightLeft className="h-5 w-5 rotate-90" aria-hidden="true" />
              </div>

              <div>
                <Label htmlFor="player-in">Player In</Label>
                <select
                  id="player-in"
                  value={playerIn}
                  onChange={(e) => setPlayerIn(e.target.value)}
                  required
                  disabled={isDeadlinePassed}
                  className={selectClass}
                >
                  <option value="">Select a player to add</option>
                  {availablePlayers.map((p) => (
                    <option key={p.playerId} value={p.playerId}>
                      {p.name} — {p.position} ({p.realTeamId}) — ${p.price}m
                    </option>
                  ))}
                </select>
              </div>

              {penaltyPreview !== null && playerOut && playerIn && (
                <p className="text-sm text-destructive" aria-live="polite">
                  This transfer will cost you a {penaltyPreview} point deduction.
                </p>
              )}

              <Button
                type="submit"
                disabled={isDeadlinePassed || !playerOut || !playerIn || transferMutation.isPending}
                className="w-full"
              >
                {transferMutation.isPending ? 'Processing...' : 'Confirm Transfer'}
              </Button>

              {isDeadlinePassed && (
                <p className="text-xs text-destructive" role="alert">
                  The transfer deadline has passed. Transfers are locked.
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      </section>

      {/* Sidebar: Chip Activation */}
      <aside className="w-full shrink-0 lg:w-80" aria-label="Chip activation panel">
        <Card>
          <CardContent className="pt-6">
            <ChipActivation
              fantasyTeamId={fantasyTeamId}
              gameweek={currentGameweek?.gameweek ?? 1}
              competitionChips={competition.chips}
              chipStates={chipStates ?? []}
              isDeadlinePassed={isDeadlinePassed}
            />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
