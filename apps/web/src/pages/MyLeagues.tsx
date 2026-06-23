import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Trash2, Trophy } from 'lucide-react';
import type { Competition } from '@fantasy/shared';
import { useApiQuery } from '../hooks/use-api';
import { apiClient } from '../lib/api-client';
import { ApiClientError } from '../lib/api-error';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface MyLeague {
  leagueId: string;
  name: string;
  competitionId: string;
  type: 'classic' | 'h2h';
  memberCount: number;
  maxMembers: number;
  isPublic: boolean;
  joinCode: string;
  isCreator: boolean;
}

export function MyLeagues() {
  const {
    data: leagues,
    isLoading,
    isError,
    error,
  } = useApiQuery<{ leagues: MyLeague[] }, MyLeague[]>(['myLeagues'], '/leagues', {
    select: (d) => d.leagues,
  });

  const { data: competitions } = useApiQuery<{ competitions: Competition[] }, Competition[]>(
    ['competitions', 'all'],
    '/competitions',
    { select: (d) => d.competitions },
  );

  const competitionName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of competitions ?? []) map.set(c.competitionId, c.name);
    return map;
  }, [competitions]);

  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MyLeague | null>(null);

  const deleteMutation = useMutation<{ message: string }, ApiClientError, string>({
    mutationFn: (leagueId) => apiClient.delete<{ message: string }>(`/leagues/${leagueId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myLeagues'] });
      setActionError(null);
      setPendingDelete(null);
    },
    onError: (err) => {
      setActionError(err.message);
      setPendingDelete(null);
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <h2 className="mb-6 font-display text-2xl font-bold">My Leagues</h2>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return <p className="text-destructive">Failed to load leagues: {error?.message}</p>;
  }

  const list = leagues ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold">My Leagues</h2>
        <div className="flex gap-2">
          <Button asChild size="sm">
            <Link to="/leagues/create">Create</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/leagues/join">Join</Link>
          </Button>
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {actionError}
        </div>
      )}

      {list.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            You're not in any leagues yet.{' '}
            <Link to="/leagues/create" className="font-medium text-primary hover:underline">
              Create one
            </Link>{' '}
            or{' '}
            <Link to="/leagues/join" className="font-medium text-primary hover:underline">
              join one
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {list.map((league) => (
            <li key={league.leagueId}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-base font-semibold text-foreground">
                          {league.name}
                        </p>
                        {league.isCreator && <Badge>Owner</Badge>}
                        {league.isPublic && <Badge variant="secondary">Public</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {competitionName.get(league.competitionId) ?? league.competitionId}
                        {' · '}
                        {league.type === 'h2h' ? 'Head-to-head' : 'Classic'}
                        {' · '}
                        <span className="font-mono tabular-nums">
                          {league.memberCount}/{league.maxMembers}
                        </span>{' '}
                        members
                      </p>
                      {!league.isPublic && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Join code:{' '}
                          <span className="font-mono font-medium tracking-wider text-foreground">
                            {league.joinCode}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button asChild size="sm">
                        <Link to={`/leagues/${league.leagueId}/standings`}>
                          <Trophy className="h-4 w-4" />
                          Standings
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/leagues/${league.leagueId}/chat`}>
                          <MessageSquare className="h-4 w-4" />
                          Chat
                        </Link>
                      </Button>
                      {league.isCreator && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setPendingDelete(league)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete league?"
        description={
          pendingDelete
            ? `Delete "${pendingDelete.name}"? This permanently removes the league for all members.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.leagueId)}
      />
    </div>
  );
}
