import { useEffect, useRef, useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../lib/utils';

export interface ScoreTickerEntry {
  playerId: string;
  playerName: string;
  currentPoints: number;
  recentChange: number;
}

interface ScoreTickerProps {
  entries: ScoreTickerEntry[];
}

export function ScoreTicker({ entries }: ScoreTickerProps) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        No score updates yet.
      </p>
    );
  }

  return (
    <ul className="space-y-2" role="list" aria-label="Live score updates">
      {entries.map((entry) => (
        <ScoreTickerItem key={entry.playerId} entry={entry} />
      ))}
    </ul>
  );
}

function ScoreTickerItem({ entry }: { entry: ScoreTickerEntry }) {
  const [flash, setFlash] = useState(false);
  const prevPointsRef = useRef(entry.currentPoints);

  useEffect(() => {
    if (entry.currentPoints !== prevPointsRef.current) {
      setFlash(true);
      prevPointsRef.current = entry.currentPoints;
      const timer = setTimeout(() => setFlash(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [entry.currentPoints]);

  const positive = entry.recentChange > 0;
  const negative = entry.recentChange < 0;
  const changePrefix = positive ? '+' : '';

  return (
    <li
      className={cn(
        'flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors duration-300',
        flash ? 'border-success/50 bg-success/10' : 'border-border bg-card',
      )}
    >
      <span className="font-medium text-foreground">{entry.playerName}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono font-semibold tabular-nums text-foreground">
          {entry.currentPoints} pts
        </span>
        {entry.recentChange !== 0 && (
          <span
            className={cn(
              'flex items-center gap-0.5 font-mono text-xs font-medium tabular-nums',
              positive ? 'text-success' : negative ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {changePrefix}
            {entry.recentChange}
          </span>
        )}
      </span>
    </li>
  );
}
