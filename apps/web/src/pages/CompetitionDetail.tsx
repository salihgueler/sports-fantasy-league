import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Radio, Users } from 'lucide-react';
import { useApiQuery, useApiMutation } from '../hooks/use-api';
import { useQueryClient } from '@tanstack/react-query';
import { FixtureList, type Fixture } from '../components/FixtureList';
import { useTheme } from '../hooks/use-theme';
import type { Competition, ChipType, Position, FantasyTeam } from '@fantasy/shared';
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

export function CompetitionDetail() {
  const { id } = useParams<{ id: string }>();

  const {
    data: competition,
    isLoading,
    isError,
    error,
  } = useApiQuery<{ competition: Competition }, Competition>(
    ['competition', id],
    `/competitions/${id}`,
    { enabled: !!id, select: (d) => d.competition },
  );

  const { data: fixtures } = useApiQuery<{ fixtures: Fixture[] }, Fixture[]>(
    ['fixtures', id],
    `/competitions/${id}/fixtures`,
    { enabled: !!id, select: (d) => d.fixtures },
  );

  // Apply the competition theme whenever data is loaded
  useTheme(competition?.competitionId, competition?.theme);

  const navigate = useNavigate();
  const [teamName, setTeamName] = useState('');
  const createTeam = useApiMutation<
    { fantasyTeam: FantasyTeam },
    { competitionId: string; teamName: string }
  >('/teams', 'POST', {
    onSuccess: (data) => navigate(`/teams/${data.fantasyTeam.fantasyTeamId}/manage`),
  });

  function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!competition) return;
    createTeam.mutate({
      competitionId: competition.competitionId,
      teamName: teamName.trim() || 'My Team',
    });
  }

  const queryClient = useQueryClient();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const syncScores = useApiMutation<
    { competitionStatus?: string; fixturesUpdated?: number; playersScored?: number },
    void
  >(`/competitions/${id}/sync`, 'POST', {
    onSuccess: (data) => {
      setSyncMessage(
        `Synced — competition ${data.competitionStatus ?? 'updated'}, ${data.fixturesUpdated ?? 0} fixtures updated, ${data.playersScored ?? 0} players scored.`,
      );
      queryClient.invalidateQueries({ queryKey: ['competition', id] });
      queryClient.invalidateQueries({ queryKey: ['competitions'] });
      queryClient.invalidateQueries({ queryKey: ['playerPool', id] });
    },
  });

  if (isLoading) {
    return (
      <p className="text-muted-foreground" aria-live="polite">
        Loading competition details...
      </p>
    );
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        {error?.message ?? 'Failed to load competition.'}
      </div>
    );
  }

  if (!competition) {
    return null;
  }

  return (
    <article aria-labelledby="competition-name">
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link
          to="/competitions"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All Competitions
        </Link>
      </nav>

      <header className="mb-6">
        <h2 id="competition-name" className="font-display text-3xl font-bold">
          {competition.name}
        </h2>
        <p className="mt-1 text-muted-foreground">
          {competition.sport} &middot; {competition.format} &middot;{' '}
          <span className="capitalize">{competition.status}</span>
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to={`/competitions/${competition.competitionId}/draft`}>
            <Users className="h-4 w-4" />
            View players
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to={`/live/${competition.competitionId}`}>
            <Radio className="h-4 w-4" />
            Live match day
          </Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setSyncMessage(null);
            syncScores.mutate();
          }}
          disabled={syncScores.isPending}
        >
          <RefreshCw className={syncScores.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          {syncScores.isPending ? 'Syncing scores…' : 'Sync scores now'}
        </Button>
      </div>

      {syncScores.isError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {syncScores.error.message}
        </p>
      )}
      {syncMessage && <p className="mb-4 text-sm text-success">{syncMessage}</p>}

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Your Team</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateTeam} className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="team-name">Team name</Label>
              <Input
                id="team-name"
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                maxLength={50}
                placeholder="My Team"
                className="w-56"
              />
            </div>
            <Button type="submit" disabled={createTeam.isPending}>
              {createTeam.isPending ? 'Creating…' : 'Create / manage my team'}
            </Button>
          </form>
          {createTeam.error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {createTeam.error.message}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <RosterConfigSection config={competition.rosterConfig} />
        <TransferRulesSection rules={competition.transferRules} />
        <ChipsSection chips={competition.chips} />
        <ScheduleSection gameweeks={competition.schedule.gameweeks} />
        <ScoringInfoSection rulesetId={competition.scoringRulesetId} />
      </div>

      <section aria-labelledby="fixtures-heading" className="mt-8">
        <h3 id="fixtures-heading" className="mb-3 font-display text-lg font-semibold">
          Fixtures &amp; Results
        </h3>
        <Card>
          <CardContent className="max-h-[32rem] overflow-y-auto pt-6">
            <FixtureList fixtures={fixtures ?? []} />
          </CardContent>
        </Card>
      </section>
    </article>
  );
}

function RosterConfigSection({ config }: { config: Competition['rosterConfig'] }) {
  return (
    <Card aria-labelledby="roster-heading">
      <CardHeader>
        <CardTitle id="roster-heading" className="text-lg">
          Roster Configuration
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          <DescriptionItem label="Squad Size" value={String(config.squadSize)} />
          <DescriptionItem label="Starting XI" value={String(config.startingXI)} />
          <DescriptionItem label="Budget" value={config.budget.toLocaleString()} />
          <DescriptionItem label="Captain Multiplier" value={`x${config.captainMultiplier}`} />
          <DescriptionItem label="Per-Team Cap" value={String(config.perTeamCap)} />
        </dl>

        <h4 className="mt-4 text-sm font-medium text-foreground">Positions</h4>
        <ul className="mt-2 space-y-1" role="list">
          {config.positions.map((pos: Position) => (
            <li key={pos.name} className="flex justify-between text-sm text-muted-foreground">
              <span>{pos.name}</span>
              <span className="font-mono tabular-nums">
                {pos.min}&ndash;{pos.max}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function TransferRulesSection({ rules }: { rules: Competition['transferRules'] }) {
  return (
    <Card aria-labelledby="transfers-heading">
      <CardHeader>
        <CardTitle id="transfers-heading" className="text-lg">
          Transfer Rules
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          <DescriptionItem
            label="Free Transfers per Gameweek"
            value={String(rules.freeTransfersPerGameweek)}
          />
          <DescriptionItem label="Carry-Over Limit" value={String(rules.carryOverLimit)} />
          <DescriptionItem
            label="Penalty per Extra Transfer"
            value={`${rules.penaltyPointsPerExtra} pts`}
          />
          <DescriptionItem
            label="Triple Captain Multiplier"
            value={`x${rules.tripleCaptainMultiplier}`}
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function ChipsSection({ chips }: { chips: ChipType[] }) {
  if (chips.length === 0) {
    return null;
  }

  const chipLabels: Record<ChipType, string> = {
    WILDCARD: 'Wildcard',
    TRIPLE_CAPTAIN: 'Triple Captain',
    BENCH_BOOST: 'Bench Boost',
    FREE_HIT: 'Free Hit',
  };

  return (
    <Card aria-labelledby="chips-heading">
      <CardHeader>
        <CardTitle id="chips-heading" className="text-lg">
          Available Chips
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-wrap gap-2" role="list">
          {chips.map((chip) => (
            <li key={chip}>
              <Badge variant="secondary">{chipLabels[chip]}</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ScheduleSection({ gameweeks }: { gameweeks: Competition['schedule']['gameweeks'] }) {
  return (
    <Card aria-labelledby="schedule-heading">
      <CardHeader>
        <CardTitle id="schedule-heading" className="text-lg">
          Schedule ({gameweeks.length} Gameweeks)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {gameweeks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No gameweeks scheduled yet.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <Table aria-label="Gameweek schedule">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>GW</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gameweeks.map((gw) => (
                  <TableRow key={gw.gameweek}>
                    <TableCell className="font-mono tabular-nums font-medium text-foreground">
                      {gw.gameweek}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDeadline(gw.transferDeadline)}
                    </TableCell>
                    <TableCell>
                      <GameweekStatusBadge status={gw.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScoringInfoSection({ rulesetId }: { rulesetId: string }) {
  return (
    <Card aria-labelledby="scoring-heading">
      <CardHeader>
        <CardTitle id="scoring-heading" className="text-lg">
          Scoring
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          <DescriptionItem label="Ruleset ID" value={rulesetId} />
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          Full scoring breakdown is derived from the competition ruleset configuration.
        </p>
      </CardContent>
    </Card>
  );
}

function DescriptionItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function GameweekStatusBadge({ status }: { status: string }) {
  if (status === 'live') {
    return <Badge variant="live">live</Badge>;
  }
  if (status === 'upcoming') {
    return <Badge variant="outline">upcoming</Badge>;
  }
  return <span className="text-xs capitalize text-muted-foreground">{status}</span>;
}

function formatDeadline(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
