import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { apiClient } from '../lib/api-client';
import { ApiClientError } from '../lib/api-error';
import { useWebSocket } from '../hooks/use-websocket';
import { useAuthStore } from '../stores/auth-store';
import { ChatMessage } from '../components/ChatMessage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

interface ChatMessageData {
  messageId: string;
  leagueId: string;
  userId: string;
  body: string;
  createdAt: string;
}

interface ChatHistoryResponse {
  messages: ChatMessageData[];
  nextPageToken: string | null;
}

interface SendMessageInput {
  body: string;
}

const MAX_MESSAGE_LENGTH = 500;

export function LeagueChat() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { latestEvents } = useWebSocket();

  const [messageText, setMessageText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const processedEventIdsRef = useRef<Set<string>>(new Set());

  // Fetch paginated chat history
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError } =
    useInfiniteQuery<ChatHistoryResponse, ApiClientError>({
      queryKey: ['league-chat', leagueId],
      queryFn: async ({ pageParam }) => {
        const params = pageParam ? `?pageToken=${encodeURIComponent(pageParam as string)}` : '';
        return apiClient.get<ChatHistoryResponse>(`/leagues/${leagueId}/chat${params}`);
      },
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
      enabled: !!leagueId,
    });

  // Send message mutation
  const sendMutation = useMutation<ChatMessageData, ApiClientError, SendMessageInput>({
    mutationFn: async (variables) => {
      const resp = await apiClient.post<{ message: ChatMessageData }>(
        `/leagues/${leagueId}/chat`,
        variables,
      );
      return resp.message;
    },
    onSuccess: (newMessage) => {
      queryClient.setQueryData<{
        pages: ChatHistoryResponse[];
        pageParams: (string | null)[];
      }>(['league-chat', leagueId], (old) => {
        if (!old) return old;
        const firstPage = old.pages[0];
        if (firstPage.messages.some((m) => m.messageId === newMessage.messageId)) return old;
        return {
          ...old,
          pages: [
            { ...firstPage, messages: [newMessage, ...firstPage.messages] },
            ...old.pages.slice(1),
          ],
        };
      });
      setMessageText('');
      setValidationError(null);
    },
    onError: (error) => {
      if (error.code === 'EMPTY_MESSAGE') {
        setValidationError('Message cannot be empty.');
      } else if (error.code === 'MESSAGE_TOO_LONG') {
        setValidationError(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
      } else {
        setValidationError(error.message ?? 'Failed to send message.');
      }
    },
  });

  // Listen for incoming WebSocket ChatMessage events
  useEffect(() => {
    const chatEvents = latestEvents.filter(
      (e) =>
        e.type === 'ChatMessage' &&
        (e.payload as ChatMessageData | undefined)?.leagueId === leagueId,
    );

    for (const event of chatEvents) {
      const msg = event.payload as ChatMessageData;
      if (processedEventIdsRef.current.has(msg.messageId)) continue;
      processedEventIdsRef.current.add(msg.messageId);

      queryClient.setQueryData<{
        pages: ChatHistoryResponse[];
        pageParams: (string | null)[];
      }>(['league-chat', leagueId], (old) => {
        if (!old) return old;
        const firstPage = old.pages[0];
        // Avoid duplicates
        if (firstPage.messages.some((m) => m.messageId === msg.messageId)) return old;
        return {
          ...old,
          pages: [{ ...firstPage, messages: [msg, ...firstPage.messages] }, ...old.pages.slice(1)],
        };
      });
    }
  }, [latestEvents, leagueId, queryClient]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.pages?.[0]?.messages?.length]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = messageText.trim();

    if (!trimmed) {
      setValidationError('Message cannot be empty.');
      return;
    }

    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      setValidationError(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
      return;
    }

    setValidationError(null);
    sendMutation.mutate({ body: trimmed });
  }

  // Flatten messages from all pages (most recent first from API, display oldest at top)
  const allMessages = data?.pages.flatMap((page) => page.messages).reverse() ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" aria-live="polite">
        <p className="text-muted-foreground">Loading chat…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-12" role="alert">
        <p className="text-destructive">Failed to load chat history.</p>
      </div>
    );
  }

  return (
    <section aria-label="League chat" className="flex h-[calc(100vh-10rem)] flex-col">
      {/* Message list */}
      <div
        className="flex-1 overflow-y-auto rounded-t-lg border bg-card p-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {hasNextPage && (
          <div className="mb-4 text-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load older messages'}
            </Button>
          </div>
        )}

        {allMessages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            No messages yet. Be the first to say something!
          </p>
        )}

        <div className="space-y-3">
          {allMessages.map((msg) => (
            <ChatMessage
              key={msg.messageId}
              id={msg.messageId}
              senderDisplayName={msg.userId}
              content={msg.body}
              createdAt={msg.createdAt}
              isOwnMessage={msg.userId === user?.userId}
            />
          ))}
        </div>
        <div ref={messagesEndRef} />
      </div>

      {/* Message input */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 rounded-b-lg border border-t-0 bg-muted/40 p-3"
      >
        <div className="flex flex-1 flex-col">
          <label htmlFor="chat-message-input" className="sr-only">
            Type a message
          </label>
          <Input
            id="chat-message-input"
            type="text"
            value={messageText}
            onChange={(e) => {
              setMessageText(e.target.value);
              if (validationError) setValidationError(null);
            }}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Type a message…"
            aria-describedby={validationError ? 'chat-validation-error' : undefined}
            aria-invalid={!!validationError}
          />
          {validationError && (
            <p id="chat-validation-error" role="alert" className="mt-1 text-xs text-destructive">
              {validationError}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">
              {messageText.length}/{MAX_MESSAGE_LENGTH}
            </span>
          </p>
        </div>

        <Button type="submit" disabled={sendMutation.isPending} className="self-start">
          <Send className="h-4 w-4" />
          {sendMutation.isPending ? 'Sending…' : 'Send'}
        </Button>
      </form>
    </section>
  );
}
