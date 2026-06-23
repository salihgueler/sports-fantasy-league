import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { Competition, Player } from '@fantasy/shared';
import { useApiQuery } from '../hooks/use-api';
import { PlayerPoolFilters, type PlayerPoolFilterValues } from '../components/PlayerPoolFilters';
import { PlayerTable } from '../components/PlayerTable';
import { Card, CardContent } from '../components/ui/card';

const DEFAULT_FILTERS: PlayerPoolFilterValues = {
  team: '',
  position: '',
  minPrice: '',
  maxPrice: '',
  minPoints: '',
  availability: '',
};

export function DraftRoom() {
  const { competitionId } = useParams<{ competitionId: string }>();
  const [filters, setFilters] = useState<PlayerPoolFilterValues>(DEFAULT_FILTERS);

  // Fetch competition config to get RosterConfig positions
  const {
    data: competition,
    isLoading: competitionLoading,
    error: competitionError,
  } = useApiQuery<{ competition: Competition }, Competition>(
    ['competition', competitionId],
    `/competitions/${competitionId}`,
    { enabled: !!competitionId, select: (d) => d.competition },
  );

  // Build query params from active filters
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.team) params.set('team', filters.team);
    if (filters.position) params.set('position', filters.position);
    if (filters.minPrice) params.set('minPrice', filters.minPrice);
    if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);
    if (filters.minPoints) params.set('minPoints', filters.minPoints);
    if (filters.availability) params.set('availability', filters.availability);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [filters]);

  // Fetch the player pool
  const {
    data: players,
    isLoading: playersLoading,
    error: playersError,
  } = useApiQuery<{ players: Player[] }, Player[]>(
    ['playerPool', competitionId, queryParams],
    `/competitions/${competitionId}/players${queryParams}`,
    {
      enabled: !!competitionId,
      select: (d) => d.players.filter((p) => typeof p.price === 'number'),
    },
  );

  // Derive unique teams from returned players for the filter dropdown
  const teams = useMemo(() => {
    if (!players) return [];
    const set = new Set(players.map((p) => p.realTeamId));
    return Array.from(set).sort();
  }, [players]);

  // Derive position names from RosterConfig (dynamic, not hardcoded)
  const positionNames = useMemo(() => {
    if (!competition) return [];
    return competition.rosterConfig.positions.map((p) => p.name);
  }, [competition]);

  if (!competitionId) {
    return <p className="text-destructive">No competition selected.</p>;
  }

  if (competitionLoading) {
    return <p className="text-muted-foreground">Loading competition…</p>;
  }

  if (competitionError) {
    return (
      <p className="text-destructive">Failed to load competition: {competitionError.message}</p>
    );
  }

  if (!competition) {
    return <p className="text-destructive">Competition not found.</p>;
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Left panel: Player Pool */}
      <section className="min-w-0 flex-1" aria-label="Player pool">
        <h2 className="mb-4 font-display text-lg font-semibold">Player Pool</h2>

        <PlayerPoolFilters
          filters={filters}
          onChange={setFilters}
          positions={positionNames}
          teams={teams}
        />

        <div className="mt-4">
          {playersLoading ? (
            <p className="text-muted-foreground">Loading players…</p>
          ) : playersError ? (
            <p className="text-destructive">Failed to load players: {playersError.message}</p>
          ) : (
            <PlayerTable players={players ?? []} />
          )}
        </div>
      </section>

      {/* Right panel: Squad Slots (from RosterConfig) */}
      <aside className="w-full shrink-0 lg:w-80" aria-label="Squad slots">
        <h2 className="mb-4 font-display text-lg font-semibold">Squad Slots</h2>

        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm text-muted-foreground">
              Budget:{' '}
              <span className="font-mono font-medium tabular-nums text-foreground">
                {competition.rosterConfig.budget}
              </span>
              {' · '}
              Squad size:{' '}
              <span className="font-mono font-medium tabular-nums text-foreground">
                {competition.rosterConfig.squadSize}
              </span>
            </p>

            <ul className="divide-y">
              {competition.rosterConfig.positions.map((pos) => (
                <li key={pos.name} className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium text-foreground">{pos.name}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {pos.min}–{pos.max} slots
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-3 text-xs text-muted-foreground">
              Max {competition.rosterConfig.perTeamCap} players per team
              {' · '}
              Captain multiplier: ×{competition.rosterConfig.captainMultiplier}
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
