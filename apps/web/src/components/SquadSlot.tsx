import { X } from 'lucide-react';
import type { Player, SquadSlot as SquadSlotType } from '@fantasy/shared';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

interface SquadSlotProps {
  slot: SquadSlotType | null;
  player: Player | undefined;
  positionName: string;
  onRemove?: (playerId: string) => void;
  onSetCaptain?: (playerId: string) => void;
  onSetViceCaptain?: (playerId: string) => void;
}

export function SquadSlot({
  slot,
  player,
  positionName,
  onRemove,
  onSetCaptain,
  onSetViceCaptain,
}: SquadSlotProps) {
  if (!slot || !player) {
    return (
      <div
        className="flex items-center justify-between rounded-md border border-dashed bg-muted/40 px-3 py-2"
        aria-label={`Empty ${positionName} slot`}
      >
        <span className="text-sm text-muted-foreground">Empty {positionName} slot</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
      aria-label={`${player.name} - ${positionName}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{player.name}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {player.price.toFixed(1)}
        </span>
        {slot.isCaptain && <Badge className="h-5 px-1.5">C</Badge>}
        {slot.isViceCaptain && (
          <Badge variant="secondary" className="h-5 px-1.5">
            VC
          </Badge>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onSetCaptain && !slot.isCaptain && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onSetCaptain(slot.playerId)}
            aria-label={`Set ${player.name} as captain`}
          >
            C
          </Button>
        )}
        {onSetViceCaptain && !slot.isViceCaptain && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onSetViceCaptain(slot.playerId)}
            aria-label={`Set ${player.name} as vice-captain`}
          >
            VC
          </Button>
        )}
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onRemove(slot.playerId)}
            aria-label={`Remove ${player.name} from squad`}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
