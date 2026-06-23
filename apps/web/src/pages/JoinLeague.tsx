import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { Competition } from '@fantasy/shared';
import { useApiMutation, useApiQuery } from '../hooks/use-api';
import { apiClient } from '../lib/api-client';
import { ApiClientError } from '../lib/api-error';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

interface JoinByCodeInput {
  joinCode: string;
}

interface JoinLeagueResponse {
  leagueId: string;
  name: string;
}

interface PublicLeague {
  leagueId: string;
  name: string;
  competitionId: string;
  type: 'classic' | 'h2h';
  memberCount: number;
  maxMembers: number;
}

export function JoinLeague() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [activeTab, setActiveTab] = useState<'code' | 'public'>('code');
  const [selectedCompetitionId, setSelectedCompetitionId] = useState('');

  const joinByCodeMutation = useApiMutation<JoinLeagueResponse, JoinByCodeInput>(
    '/leagues/join-by-code',
    'POST',
    {
      onSuccess() {
        navigate('/');
      },
    },
  );

  function handleJoinByCode(e: FormEvent) {
    e.preventDefault();
    joinByCodeMutation.mutate({ joinCode: joinCode.trim() });
  }

  // ─── Public leagues ─────────────────────────────────────────────────────

  const { data: competitions } = useApiQuery<{ competitions: Competition[] }, Competition[]>(
    ['competitions', 'all'],
    '/competitions',
    { select: (d) => d.competitions, enabled: activeTab === 'public' },
  );

  // Default the competition selector to the first competition once loaded.
  useEffect(() => {
    if (!selectedCompetitionId && competitions && competitions.length > 0) {
      setSelectedCompetitionId(competitions[0].competitionId);
    }
  }, [competitions, selectedCompetitionId]);

  const {
    data: publicLeagues,
    isLoading: leaguesLoading,
    isError: leaguesError,
    error: leaguesErrorObj,
  } = useApiQuery<{ leagues: PublicLeague[] }, PublicLeague[]>(
    ['publicLeagues', selectedCompetitionId],
    `/leagues/public?competitionId=${selectedCompetitionId}`,
    { enabled: activeTab === 'public' && !!selectedCompetitionId, select: (d) => d.leagues },
  );

  const joinPublicMutation = useMutation<{ message: string }, ApiClientError, string>({
    mutationFn: (leagueId) => apiClient.post<{ message: string }>(`/leagues/${leagueId}/join`),
    onSuccess: () => navigate('/'),
  });

  return (
    <div className="mx-auto max-w-lg py-8">
      <h2 className="mb-6 font-display text-2xl font-bold">Join a League</h2>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'code' | 'public')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="code">Join by Code</TabsTrigger>
          <TabsTrigger value="public">Browse Public</TabsTrigger>
        </TabsList>

        {/* Join by Code panel */}
        <TabsContent value="code">
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={handleJoinByCode} className="space-y-4">
                {joinByCodeMutation.error && (
                  <div
                    role="alert"
                    className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    {joinByCodeMutation.error.message}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="join-code">Join Code</Label>
                  <Input
                    id="join-code"
                    type="text"
                    required
                    maxLength={8}
                    pattern="[A-Za-z0-9]{8}"
                    title="8 alphanumeric characters"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    className="text-center font-mono text-lg tracking-[0.4em]"
                    placeholder="ABCD1234"
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter the 8-character code shared by the league creator.
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={joinByCodeMutation.isPending || joinCode.length !== 8}
                  className="w-full"
                >
                  {joinByCodeMutation.isPending ? 'Joining…' : 'Join League'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Public Leagues panel */}
        <TabsContent value="public">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Browse Public Leagues</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {joinPublicMutation.error && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {joinPublicMutation.error.message}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="comp-select">Competition</Label>
                <Select
                  value={selectedCompetitionId}
                  onValueChange={setSelectedCompetitionId}
                  disabled={(competitions ?? []).length === 0}
                >
                  <SelectTrigger id="comp-select">
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

              {leaguesLoading ? (
                <p className="text-sm text-muted-foreground">Loading public leagues…</p>
              ) : leaguesError ? (
                <p className="text-sm text-destructive">
                  Failed to load leagues: {leaguesErrorObj?.message}
                </p>
              ) : (publicLeagues ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No public leagues for this competition yet. Create one from “Create League” and
                  mark it public.
                </p>
              ) : (
                <ul className="space-y-2">
                  {(publicLeagues ?? []).map((league) => {
                    const full = league.memberCount >= league.maxMembers;
                    return (
                      <li
                        key={league.leagueId}
                        className="flex items-center justify-between rounded-md border bg-card p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {league.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {league.type === 'h2h' ? 'Head-to-head' : 'Classic'} ·{' '}
                            <span className="font-mono tabular-nums">
                              {league.memberCount}/{league.maxMembers}
                            </span>{' '}
                            members
                          </p>
                        </div>
                        {full ? (
                          <Badge variant="secondary" className="shrink-0">
                            Full
                          </Badge>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => joinPublicMutation.mutate(league.leagueId)}
                            disabled={joinPublicMutation.isPending}
                            className="shrink-0"
                          >
                            {joinPublicMutation.isPending ? 'Joining…' : 'Join'}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <p className="text-xs text-muted-foreground">
                You need a team for the selected competition before joining — create one from the
                competition page.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
