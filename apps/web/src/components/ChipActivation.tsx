import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChipType } from '@fantasy/shared';
import { useApiMutation } from '../hooks/use-api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

interface ChipState {
  chipType: ChipType;
  remainingUses: number;
  isActive: boolean;
}

interface ChipActivationProps {
  fantasyTeamId: string;
  gameweek: number;
  competitionChips: ChipType[];
  chipStates: ChipState[];
  isDeadlinePassed: boolean;
}

const CHIP_LABELS: Record<ChipType, string> = {
  WILDCARD: 'Wildcard',
  TRIPLE_CAPTAIN: 'Triple Captain',
  BENCH_BOOST: 'Bench Boost',
  FREE_HIT: 'Free Hit',
};

const CHIP_DESCRIPTIONS: Record<ChipType, string> = {
  WILDCARD: 'Make unlimited free transfers this gameweek',
  TRIPLE_CAPTAIN: 'Your captain scores triple points',
  BENCH_BOOST: 'All bench players score points this gameweek',
  FREE_HIT: 'Temporary squad changes for this gameweek only',
};

export function ChipActivation({
  fantasyTeamId,
  gameweek,
  competitionChips,
  chipStates,
  isDeadlinePassed,
}: ChipActivationProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const activateChipMutation = useApiMutation<
    void,
    { fantasyTeamId: string; chipType: ChipType; gameweek: number }
  >('/gameweeks/activate-chip', 'POST', {
    onSuccess(_data, variables) {
      setError(null);
      setSuccessMessage(`${CHIP_LABELS[variables.chipType]} activated for Gameweek ${gameweek}`);
      queryClient.invalidateQueries({ queryKey: ['chipStates', fantasyTeamId] });
      queryClient.invalidateQueries({ queryKey: ['fantasyTeam', fantasyTeamId] });
    },
    onError(err) {
      setSuccessMessage(null);
      switch (err.code) {
        case 'CHIP_NOT_CONFIGURED':
          setError('This chip is not configured for the current competition.');
          break;
        case 'CHIP_UNAVAILABLE':
          setError('No remaining uses for this chip.');
          break;
        case 'CHIP_ALREADY_ACTIVE':
          setError('Another chip is already active for this gameweek.');
          break;
        case 'TRANSFER_DEADLINE_PASSED':
          setError('The transfer deadline has passed. Chip activation is locked.');
          break;
        default:
          setError(err.message);
      }
    },
  });

  const activeChip = chipStates.find((c) => c.isActive);

  function handleActivate(chipType: ChipType) {
    setError(null);
    setSuccessMessage(null);
    activateChipMutation.mutate({ fantasyTeamId, chipType, gameweek });
  }

  return (
    <section aria-label="Chip activation">
      <h3 className="mb-3 font-display text-base font-semibold">Chips</h3>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="mb-3 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success"
        >
          {successMessage}
        </div>
      )}

      {activeChip && (
        <p className="mb-3 text-sm font-medium text-primary">
          Active: {CHIP_LABELS[activeChip.chipType]}
        </p>
      )}

      <ul className="space-y-2">
        {competitionChips.map((chipType) => {
          const state = chipStates.find((c) => c.chipType === chipType);
          const remainingUses = state?.remainingUses ?? 0;
          const isThisActive = state?.isActive ?? false;
          const canActivate = !isDeadlinePassed && !activeChip && remainingUses > 0;

          return (
            <li
              key={chipType}
              className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{CHIP_LABELS[chipType]}</p>
                <p className="text-xs text-muted-foreground">{CHIP_DESCRIPTIONS[chipType]}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span className="font-mono tabular-nums">{remainingUses}</span> use
                  {remainingUses !== 1 ? 's' : ''} remaining
                </p>
              </div>

              <div className="ml-3 shrink-0">
                {isThisActive ? (
                  <Badge>Active</Badge>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canActivate || activateChipMutation.isPending}
                    onClick={() => handleActivate(chipType)}
                    aria-label={`Activate ${CHIP_LABELS[chipType]}`}
                  >
                    {activateChipMutation.isPending ? 'Activating…' : 'Activate'}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {isDeadlinePassed && (
        <p className="mt-3 text-xs text-muted-foreground">
          The transfer deadline has passed. Chip activation is locked.
        </p>
      )}
    </section>
  );
}
