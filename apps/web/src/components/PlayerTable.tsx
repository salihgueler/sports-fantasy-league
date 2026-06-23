import { useState, useMemo } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { Player } from '@fantasy/shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';

type SortField = 'name' | 'position' | 'price' | 'totalPoints' | 'availability';
type SortDirection = 'asc' | 'desc';

interface PlayerTableProps {
  players: Player[];
}

export function PlayerTable({ players }: PlayerTableProps) {
  const [sortField, setSortField] = useState<SortField>('totalPoints');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'position':
          cmp = a.position.localeCompare(b.position);
          break;
        case 'price':
          cmp = a.price - b.price;
          break;
        case 'totalPoints':
          cmp = a.totalPoints - b.totalPoints;
          break;
        case 'availability':
          cmp = a.availability.localeCompare(b.availability);
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [players, sortField, sortDirection]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'name' ? 'asc' : 'desc');
    }
  }

  function renderSortIndicator(field: SortField) {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <ArrowUp className="ml-1 inline h-3 w-3" aria-hidden="true" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3" aria-hidden="true" />
    );
  }

  const columns: { field: SortField; label: string; numeric?: boolean }[] = [
    { field: 'name', label: 'Player' },
    { field: 'position', label: 'Position' },
    { field: 'price', label: 'Price', numeric: true },
    { field: 'totalPoints', label: 'Points', numeric: true },
    { field: 'availability', label: 'Status' },
  ];

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map(({ field, label, numeric }) => (
              <TableHead
                key={field}
                scope="col"
                className={cn(
                  'cursor-pointer select-none hover:text-foreground',
                  numeric && 'text-right',
                )}
                onClick={() => handleSort(field)}
                aria-sort={
                  sortField === field
                    ? sortDirection === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                {label}
                {renderSortIndicator(field)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedPlayers.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                No players match the current filters.
              </TableCell>
            </TableRow>
          ) : (
            sortedPlayers.map((player) => (
              <TableRow key={player.playerId}>
                <TableCell className="font-medium text-foreground">{player.name}</TableCell>
                <TableCell className="text-muted-foreground">{player.position}</TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {player.price.toFixed(1)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums font-semibold text-foreground">
                  {player.totalPoints}
                </TableCell>
                <TableCell>
                  <AvailabilityBadge availability={player.availability} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function AvailabilityBadge({ availability }: { availability: Player['availability'] }) {
  const variant: Record<Player['availability'], React.ComponentProps<typeof Badge>['variant']> = {
    available: 'success',
    injured: 'destructive',
    suspended: 'destructive',
    doubtful: 'secondary',
    unavailable: 'outline',
  };

  return (
    <Badge variant={variant[availability]} className="capitalize">
      {availability}
    </Badge>
  );
}
