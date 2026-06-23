import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import type { Competition, FantasyTeam } from '@fantasy/shared';
import { useApiQuery } from '../hooks/use-api';
import { apiClient } from '../lib/api-client';
import { ApiClientError } from '../lib/api-error';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function MyTeams() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FantasyTeam | null>(null);

  const {
    data: teams,
    isLoading,
    isError,
    error,
  } = useApiQuery<{ teams: FantasyTeam[] }, FantasyTeam[]>(['myTeams'], '/teams', {
    select: (d) => d.teams,
  });

  const { data: competitions } = useApiQuery<{ competitions: Competition[] }, Competition[]>(
    ['competitions', 'all'],
    '/competitions',
    { select: (d) => d.competitions },
  );

  const competitionById = useMemo(() => {
    const map = new Map<string, Competition>();
    for (const c of competitions ?? []) map.set(c.competitionId, c);
    return map;
  }, [competitions]);

  const renameMutation = useMutation<FantasyTeam, ApiClientError, { teamId: string; name: string }>(
    {
      mutationFn: async ({ teamId, name }) => {
        const res = await apiClient.put<{ fantasyTeam: FantasyTeam }>(`/teams/${teamId}`, { name });
        return res.fantasyTeam;
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['myTeams'] });
        setEditingId(null);
        setActionError(null);
      },
      onError: (err) => setActionError(err.message),
    },
  );

  const deleteMutation = useMutation<{ message: string }, ApiClientError, string>({
    mutationFn: (teamId) => apiClient.delete<{ message: string }>(`/teams/${teamId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTeams'] });
      setActionError(null);
      setPendingDelete(null);
    },
    onError: (err) => {
      setActionError(err.message);
      setPendingDelete(null);
    },
  });

  function startEdit(team: FantasyTeam) {
    setEditingId(team.fantasyTeamId);
    setNameInput(team.name);
    setActionError(null);
  }

  function submitRename(teamId: string) {
    const name = nameInput.trim();
    if (!name) {
      setActionError('Team name cannot be empty.');
      return;
    }
    renameMutation.mutate({ teamId, name });
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <h2 className="mb-6 font-display text-2xl font-bold">My Teams</h2>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return <p className="text-destructive">Failed to load teams: {error?.message}</p>;
  }

  const teamList = teams ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="mb-6 font-display text-2xl font-bold">My Teams</h2>

      {actionError && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {actionError}
        </div>
      )}

      {teamList.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            You don't have any teams yet.{' '}
            <Link to="/competitions" className="font-medium text-primary hover:underline">
              Browse competitions
            </Link>{' '}
            to create one.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {teamList.map((team) => {
            const comp = competitionById.get(team.competitionId);
            const squadSize = comp?.rosterConfig.squadSize;
            const isEditing = editingId === team.fantasyTeamId;
            return (
              <li key={team.fantasyTeamId}>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <label htmlFor={`rename-${team.fantasyTeamId}`} className="sr-only">
                              Team name
                            </label>
                            <Input
                              id={`rename-${team.fantasyTeamId}`}
                              type="text"
                              value={nameInput}
                              onChange={(e) => setNameInput(e.target.value)}
                              maxLength={50}
                              className="h-9 w-56"
                            />
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => submitRename(team.fantasyTeamId)}
                              disabled={renameMutation.isPending}
                            >
                              Save
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <p className="truncate text-base font-semibold text-foreground">
                            {team.name}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {comp?.name ?? team.competitionId}
                          {' · '}Squad{' '}
                          <span className="font-mono tabular-nums">
                            {team.squad?.length ?? 0}
                            {squadSize ? `/${squadSize}` : ''}
                          </span>
                          {' · '}
                          <span className="font-mono tabular-nums">{team.totalPoints}</span> pts
                        </p>
                      </div>

                      {!isEditing && (
                        <div className="flex shrink-0 items-center gap-2">
                          <Button asChild size="sm">
                            <Link to={`/teams/${team.fantasyTeamId}/manage`}>Manage</Link>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => startEdit(team)}
                          >
                            <Pencil className="h-4 w-4" />
                            Rename
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setPendingDelete(team)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete team?"
        description={
          pendingDelete
            ? `Delete "${pendingDelete.name}"? This also removes you from any leagues you joined with it.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.fantasyTeamId)}
      />
    </div>
  );
}
