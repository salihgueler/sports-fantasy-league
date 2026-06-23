import { type ChangeEvent } from 'react';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { cn } from '../lib/utils';

export interface PlayerPoolFilterValues {
  team: string;
  position: string;
  minPrice: string;
  maxPrice: string;
  minPoints: string;
  availability: string;
}

interface PlayerPoolFiltersProps {
  filters: PlayerPoolFilterValues;
  onChange: (filters: PlayerPoolFilterValues) => void;
  positions: string[];
  teams: string[];
}

const selectClass = cn(
  'flex h-10 w-full items-center rounded-md border border-input bg-card px-3 py-2 text-sm',
  'ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export function PlayerPoolFilters({ filters, onChange, positions, teams }: PlayerPoolFiltersProps) {
  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    onChange({ ...filters, [e.target.name]: e.target.value });
  }

  return (
    <fieldset className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
      <legend className="px-2 text-sm font-medium text-foreground">Filter Players</legend>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-position">Position</Label>
        <select
          id="filter-position"
          name="position"
          value={filters.position}
          onChange={handleChange}
          className={cn(selectClass, 'w-40')}
        >
          <option value="">All positions</option>
          {positions.map((pos) => (
            <option key={pos} value={pos}>
              {pos}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-team">Team</Label>
        <select
          id="filter-team"
          name="team"
          value={filters.team}
          onChange={handleChange}
          className={cn(selectClass, 'w-40')}
        >
          <option value="">All teams</option>
          {teams.map((team) => (
            <option key={team} value={team}>
              {team}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-min-price">Min Price</Label>
        <Input
          id="filter-min-price"
          type="number"
          name="minPrice"
          value={filters.minPrice}
          onChange={handleChange}
          placeholder="0"
          min="0"
          step="0.1"
          className="w-24 font-mono tabular-nums"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-max-price">Max Price</Label>
        <Input
          id="filter-max-price"
          type="number"
          name="maxPrice"
          value={filters.maxPrice}
          onChange={handleChange}
          placeholder="∞"
          min="0"
          step="0.1"
          className="w-24 font-mono tabular-nums"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-min-points">Min Points</Label>
        <Input
          id="filter-min-points"
          type="number"
          name="minPoints"
          value={filters.minPoints}
          onChange={handleChange}
          placeholder="0"
          min="0"
          className="w-24 font-mono tabular-nums"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-availability">Availability</Label>
        <select
          id="filter-availability"
          name="availability"
          value={filters.availability}
          onChange={handleChange}
          className={cn(selectClass, 'w-40')}
        >
          <option value="">Any</option>
          <option value="available">Available</option>
          <option value="injured">Injured</option>
          <option value="suspended">Suspended</option>
          <option value="doubtful">Doubtful</option>
          <option value="unavailable">Unavailable</option>
        </select>
      </div>
    </fieldset>
  );
}
