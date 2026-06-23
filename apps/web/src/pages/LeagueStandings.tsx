import { useParams } from 'react-router-dom';
import { useApiQuery } from '../hooks/use-api';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { cn } from '../lib/utils';

interface StandingsEntry {
  fantasyTeamId: string;
  teamName: string;
  rank: number;
  points: number;
  gameweekPoints: number;
}

export function LeagueStandings() {
  const { leagueId } = useParams<{ leagueId: string }>();

  const { data, isLoading, error } = useApiQuery<{ standings: StandingsEntry[] }, StandingsEntry[]>(
    ['standings', leagueId],
    `/leagues/${leagueId}/standings`,
    { enabled: !!leagueId, select: (d) => d.standings },
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl py-8">
        <h2 className="mb-6 font-display text-2xl font-bold">League Standings</h2>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        {error.message || 'Failed to load standings.'}
      </div>
    );
  }

  const standings = data ?? [];

  return (
    <div className="mx-auto max-w-3xl py-8">
      <h2 className="mb-6 font-display text-2xl font-bold">League Standings</h2>

      {standings.length === 0 ? (
        <p className="text-muted-foreground">No standings available yet.</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-16">Rank</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead className="text-right">GW</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {standings.map((entry) => (
                  <TableRow key={entry.fantasyTeamId}>
                    <TableCell>
                      <RankBadge rank={entry.rank} />
                    </TableCell>
                    <TableCell className="font-medium text-foreground">{entry.teamName}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-semibold text-foreground">
                      {entry.points}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {entry.gameweekPoints}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const isPodium = rank <= 3;
  const podiumStyles: Record<number, string> = {
    1: 'bg-primary text-primary-foreground',
    2: 'bg-secondary text-secondary-foreground',
    3: 'bg-success/15 text-success',
  };
  return (
    <span
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-full font-mono text-sm font-bold tabular-nums',
        isPodium ? podiumStyles[rank] : 'text-muted-foreground',
      )}
    >
      {rank}
    </span>
  );
}
