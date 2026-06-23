import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { useApiMutation, useApiQuery } from '../hooks/use-api';
import type { League, CreateLeagueInput, Competition } from '@fantasy/shared';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { cn } from '../lib/utils';

export function CreateLeague() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [competitionId, setCompetitionId] = useState('');
  const [type, setType] = useState<'classic' | 'h2h'>('classic');
  const [maxMembers, setMaxMembers] = useState(20);
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [createdLeague, setCreatedLeague] = useState<League | null>(null);

  const { data: competitions } = useApiQuery<{ competitions: Competition[] }, Competition[]>(
    ['competitions', 'all'],
    '/competitions',
    { select: (d) => d.competitions },
  );

  useEffect(() => {
    if (!competitionId && competitions && competitions.length > 0) {
      setCompetitionId(competitions[0].competitionId);
    }
  }, [competitions, competitionId]);

  const createMutation = useApiMutation<{ league: League }, CreateLeagueInput>('/leagues', 'POST', {
    onSuccess(resp) {
      setCreatedLeague(resp.league);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate({
      name,
      competitionId,
      type,
      maxMembers,
      isPublic: visibility === 'public',
    });
  }

  if (createdLeague) {
    return (
      <div className="mx-auto max-w-md py-8">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
              <CardTitle>League created</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Your league <strong className="text-foreground">{createdLeague.name}</strong> has been
              created successfully.
            </p>
            {visibility === 'private' && (
              <div className="mt-4 rounded-md border bg-muted/40 p-4">
                <p className="text-sm font-medium text-foreground">Join Code</p>
                <p className="mt-1 font-mono text-2xl font-bold tracking-[0.3em] text-primary">
                  {createdLeague.joinCode}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Share this code with friends so they can join your league.
                </p>
              </div>
            )}
            <div className="mt-6 flex gap-3">
              <Button type="button" onClick={() => navigate('/leagues')}>
                View My Leagues
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreatedLeague(null);
                  setName('');
                  createMutation.reset();
                }}
              >
                Create Another
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Create a League</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {createMutation.error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {createMutation.error.message}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="league-name">League Name</Label>
              <Input
                id="league-name"
                type="text"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Fantasy League"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="competition-id">Competition</Label>
              <Select value={competitionId} onValueChange={setCompetitionId}>
                <SelectTrigger id="competition-id">
                  <SelectValue placeholder="Select a competition…" />
                </SelectTrigger>
                <SelectContent>
                  {(competitions ?? []).map((c) => (
                    <SelectItem key={c.competitionId} value={c.competitionId}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none">Scoring Type</legend>
              <div className="grid grid-cols-2 gap-2">
                <RadioCard
                  name="league-type"
                  value="classic"
                  checked={type === 'classic'}
                  onChange={() => setType('classic')}
                  title="Classic"
                  subtitle="Total points"
                />
                <RadioCard
                  name="league-type"
                  value="h2h"
                  checked={type === 'h2h'}
                  onChange={() => setType('h2h')}
                  title="Head-to-Head"
                  subtitle="Weekly matchups"
                />
              </div>
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="max-members">Max Members</Label>
              <Input
                id="max-members"
                type="number"
                required
                min={2}
                max={100}
                value={maxMembers}
                onChange={(e) => setMaxMembers(Number(e.target.value))}
                className="font-mono tabular-nums"
              />
              <p className="text-xs text-muted-foreground">Between 2 and 100 members.</p>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none">Visibility</legend>
              <div className="grid grid-cols-2 gap-2">
                <RadioCard
                  name="visibility"
                  value="private"
                  checked={visibility === 'private'}
                  onChange={() => setVisibility('private')}
                  title="Private"
                  subtitle="Join by code"
                />
                <RadioCard
                  name="visibility"
                  value="public"
                  checked={visibility === 'public'}
                  onChange={() => setVisibility('public')}
                  title="Public"
                  subtitle="Anyone can join"
                />
              </div>
            </fieldset>

            <Button type="submit" disabled={createMutation.isPending} className="w-full">
              {createMutation.isPending ? 'Creating…' : 'Create League'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  subtitle,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 text-sm transition-colors',
        checked
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-input hover:bg-accent',
      )}
    >
      <span className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          onChange={onChange}
          className="sr-only"
        />
        <span className="font-medium text-foreground">{title}</span>
      </span>
      <span className="text-xs text-muted-foreground">{subtitle}</span>
    </label>
  );
}
