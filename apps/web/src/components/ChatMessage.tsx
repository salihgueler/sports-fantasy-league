import { cn } from '../lib/utils';

interface ChatMessageProps {
  id: string;
  senderDisplayName: string;
  content: string;
  createdAt: string;
  isOwnMessage: boolean;
}

export function ChatMessage({
  senderDisplayName,
  content,
  createdAt,
  isOwnMessage,
}: ChatMessageProps) {
  const formattedTime = new Date(createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={cn('flex flex-col', isOwnMessage ? 'items-end' : 'items-start')}>
      <span className="mb-1 text-xs font-medium text-muted-foreground">{senderDisplayName}</span>
      <div
        className={cn(
          'max-w-[75%] rounded-lg px-3 py-2 text-sm',
          isOwnMessage
            ? 'rounded-br-sm bg-primary text-primary-foreground'
            : 'rounded-bl-sm bg-muted text-foreground',
        )}
      >
        {content}
      </div>
      <time dateTime={createdAt} className="mt-1 text-xs text-muted-foreground">
        {formattedTime}
      </time>
    </div>
  );
}
