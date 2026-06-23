import { Badge } from './ui/badge';

export interface Fixture {
  fixtureId: string;
  competitionId: string;
  gameweek: number;
  round?: string;
  homeTeamId: string;
  awayTeamId: string;
  kickoffTime: string;
  status: string;
  homeScore?: number;
  awayScore?: number;
}

function formatKickoff(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'live') {
    return (
      <Badge variant="live">
        <span
          className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-success"
          aria-hidden="true"
        />
        LIVE
      </Badge>
    );
  }
  if (status === 'finished') {
    return <Badge variant="secondary">FT</Badge>;
  }
  return null;
}

export function FixtureRow({ fixture }: { fixture: Fixture }) {
  const hasScore = typeof fixture.homeScore === 'number' && typeof fixture.awayScore === 'number';
  return (
    <li className="flex items-center gap-3 border-b py-2 text-sm last:border-0">
      <span className="w-20 truncate text-right font-medium text-foreground">
        {fixture.homeTeamId}
      </span>
      <span className="min-w-[3.5rem] text-center font-mono text-base font-bold tabular-nums text-foreground">
        {hasScore ? `${fixture.homeScore}–${fixture.awayScore}` : 'v'}
      </span>
      <span className="w-20 truncate font-medium text-foreground">{fixture.awayTeamId}</span>
      <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        {fixture.status === 'scheduled' && !hasScore ? formatKickoff(fixture.kickoffTime) : null}
        <StatusBadge status={fixture.status} />
      </span>
    </li>
  );
}

export function FixtureList({ fixtures }: { fixtures: Fixture[] }) {
  if (fixtures.length === 0) {
    return <p className="text-sm text-muted-foreground">No fixtures available yet.</p>;
  }

  const byGameweek = new Map<number, Fixture[]>();
  for (const f of fixtures) {
    const arr = byGameweek.get(f.gameweek) ?? [];
    arr.push(f);
    byGameweek.set(f.gameweek, arr);
  }
  const gameweeks = Array.from(byGameweek.keys()).sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      {gameweeks.map((gw) => (
        <div key={gw}>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Gameweek {gw}
          </h4>
          <ul className="rounded-md border bg-card px-3">
            {(byGameweek.get(gw) ?? []).map((f) => (
              <FixtureRow key={f.fixtureId} fixture={f} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
