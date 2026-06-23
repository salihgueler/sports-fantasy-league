import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '../hooks/use-api';
import type { Competition, CompetitionStatus } from '@fantasy/shared';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';

type StatusFilter = 'active' | 'completed';

export function CompetitionList() {
  const [filter, setFilter] = useState<StatusFilter>('active');

  const queryPath = filter === 'completed' ? '/competitions?status=completed' : '/competitions';

  const { data, isLoading, isError, error } = useApiQuery<
    { competitions: Competition[] },
    Competition[]
  >(['competitions', filter], queryPath, { select: (d) => d.competitions });

  return (
    <section aria-labelledby="competitions-heading">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h2 id="competitions-heading" className="font-display text-2xl font-bold">
          Competitions
        </h2>

        <fieldset aria-label="Filter competitions by status">
          <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1" role="radiogroup">
            <FilterButton
              label="Upcoming & Active"
              active={filter === 'active'}
              onClick={() => setFilter('active')}
            />
            <FilterButton
              label="Completed"
              active={filter === 'completed'}
              onClick={() => setFilter('completed')}
            />
          </div>
        </fieldset>
      </div>

      {isLoading && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i}>
              <Card>
                <CardHeader className="gap-3">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-6 w-3/4" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-20" />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {isError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {error?.message ?? 'Failed to load competitions.'}
        </div>
      )}

      {data && data.length === 0 && (
        <p className="text-muted-foreground">
          No {filter === 'completed' ? 'completed' : 'upcoming or active'} competitions found.
        </p>
      )}

      {data && data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
          {data.map((competition) => (
            <li key={competition.competitionId}>
              <CompetitionCard competition={competition} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CompetitionCard({ competition }: { competition: Competition }) {
  return (
    <Link
      to={`/competitions/${competition.competitionId}`}
      className="group block h-full rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label={`View details for ${competition.name}`}
    >
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {competition.sport}
            </span>
            <StatusBadge status={competition.status} />
          </div>
          <CardTitle className="transition-colors group-hover:text-primary">
            {competition.name}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {competition.format} &middot; {competition.rosterConfig.squadSize} players &middot;
            Budget {competition.rosterConfig.budget.toLocaleString()}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {competition.schedule.gameweeks.length} gameweeks
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

function StatusBadge({ status }: { status: CompetitionStatus }) {
  const variant: Record<CompetitionStatus, React.ComponentProps<typeof Badge>['variant']> = {
    draft: 'outline',
    upcoming: 'default',
    active: 'success',
    completed: 'secondary',
  };

  return (
    <Badge variant={variant[status]} className="capitalize" aria-label={`Status: ${status}`}>
      {status}
    </Badge>
  );
}

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      variant={active ? 'default' : 'ghost'}
      size="sm"
      className="rounded-md"
    >
      {label}
    </Button>
  );
}
