import { useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useWebSocket } from '../hooks/use-websocket';
import { useApiQuery } from '../hooks/use-api';
import { ScoreTicker, type ScoreTickerEntry } from '../components/ScoreTicker';
import { FixtureRow, type Fixture } from '../components/FixtureList';
import { cn } from '../lib/utils';
import type { WsMessage } from '../lib/ws-client';

interface ScoreUpdatedPayload {
  playerId: string;
  playerName: string;
  currentPoints: number;
  pointsChange: number;
  fixture?: string;
  gameweek?: number;
}

export function LiveDashboard() {
  const { competitionId } = useParams<{ competitionId: string }>();
  const { connectionState, latestEvents, subscribe, unsubscribe } = useWebSocket();

  const { data: fixturesData } = useApiQuery<{ fixtures: Fixture[] }, Fixture[]>(
    ['fixtures', competitionId],
    `/competitions/${competitionId}/fixtures`,
    { enabled: !!competitionId, select: (d) => d.fixtures },
  );

  useEffect(() => {
    if (!competitionId) return;
    subscribe(competitionId);
    return () => {
      unsubscribe(competitionId);
    };
  }, [competitionId, subscribe, unsubscribe]);

  const scoreEvents = useMemo(() => {
    return latestEvents.filter(
      (event: WsMessage) => event.type === 'ScoreUpdated' && event.competitionId === competitionId,
    );
  }, [latestEvents, competitionId]);

  const tickerEntries = useMemo(() => {
    const playerMap = new Map<string, ScoreTickerEntry>();
    for (let i = scoreEvents.length - 1; i >= 0; i--) {
      const event = scoreEvents[i];
      const payload = event.payload as ScoreUpdatedPayload | undefined;
      if (!payload?.playerId) continue;
      playerMap.set(payload.playerId, {
        playerId: payload.playerId,
        playerName: payload.playerName ?? 'Unknown Player',
        currentPoints: payload.currentPoints ?? 0,
        recentChange: payload.pointsChange ?? 0,
      });
    }
    return Array.from(playerMap.values()).sort((a, b) => b.currentPoints - a.currentPoints);
  }, [scoreEvents]);

  const liveFixtures = useMemo(
    () => (fixturesData ?? []).filter((f) => f.status === 'live'),
    [fixturesData],
  );

  const recentResults = useMemo(
    () =>
      (fixturesData ?? [])
        .filter((f) => f.status === 'finished')
        .sort((a, b) => b.kickoffTime.localeCompare(a.kickoffTime))
        .slice(0, 12),
    [fixturesData],
  );

  if (!competitionId) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        No competition specified.
      </div>
    );
  }

  return (
    <article aria-labelledby="live-dashboard-heading">
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link
          to={`/competitions/${competitionId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Competition
        </Link>
      </nav>

      <header className="mb-6 flex items-center justify-between">
        <h2 id="live-dashboard-heading" className="font-display text-2xl font-bold">
          Live Match Day
        </h2>
        <ConnectionBadge state={connectionState} />
      </header>

      {/* Live fixtures */}
      <section aria-labelledby="live-fixtures-heading" className="mb-6">
        <h3 id="live-fixtures-heading" className="mb-2 font-display text-lg font-semibold">
          Live Now
        </h3>
        {liveFixtures.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches are live right now.</p>
        ) : (
          <ul className="rounded-lg border border-success/30 bg-success/5 px-3">
            {liveFixtures.map((f) => (
              <FixtureRow key={f.fixtureId} fixture={f} />
            ))}
          </ul>
        )}
      </section>

      {/* Latest results */}
      <section aria-labelledby="results-heading" className="mb-6">
        <h3 id="results-heading" className="mb-2 font-display text-lg font-semibold">
          Latest Results
        </h3>
        {recentResults.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed matches yet.</p>
        ) : (
          <ul className="rounded-lg border bg-card px-3">
            {recentResults.map((f) => (
              <FixtureRow key={f.fixtureId} fixture={f} />
            ))}
          </ul>
        )}
      </section>

      {/* Live player points (WebSocket) */}
      <section aria-labelledby="scores-heading">
        <h3 id="scores-heading" className="mb-3 font-display text-lg font-semibold">
          Live Player Points
        </h3>

        {connectionState === 'disconnected' && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            Connection lost. Attempting to reconnect...
          </div>
        )}

        {connectionState === 'connecting' && (
          <div
            aria-live="polite"
            className="mb-4 rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-primary"
          >
            Connecting to live updates...
          </div>
        )}

        {tickerEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Live player point updates appear here during matches.
          </p>
        ) : (
          <ScoreTicker entries={tickerEntries} />
        )}
      </section>
    </article>
  );
}

function ConnectionBadge({ state }: { state: string }) {
  const dotClass: Record<string, string> = {
    connected: 'bg-success',
    connecting: 'bg-secondary-foreground',
    disconnected: 'bg-destructive',
  };
  const wrapClass: Record<string, string> = {
    connected: 'bg-success/15 text-success',
    connecting: 'bg-secondary text-secondary-foreground',
    disconnected: 'bg-destructive/15 text-destructive',
  };
  const labels: Record<string, string> = {
    connected: 'Live',
    connecting: 'Connecting...',
    disconnected: 'Disconnected',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        wrapClass[state] ?? wrapClass.disconnected,
      )}
      aria-label={`Connection status: ${labels[state] ?? state}`}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          dotClass[state] ?? dotClass.disconnected,
          state === 'connected' && 'animate-live-pulse',
        )}
        aria-hidden="true"
      />
      {labels[state] ?? state}
    </span>
  );
}
