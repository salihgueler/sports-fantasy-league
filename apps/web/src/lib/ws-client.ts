import { getAccessToken } from './auth';

export type WsConnectionState = 'disconnected' | 'connecting' | 'connected';

export interface WsMessage {
  type: string;
  competitionId?: string;
  payload?: unknown;
}

type MessageHandler = (message: WsMessage) => void;
type StateChangeHandler = (state: WsConnectionState) => void;

const MAX_SUBSCRIPTIONS = 50;
const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

export class WsClient {
  private ws: WebSocket | null = null;
  private subscriptions = new Set<string>();
  private messageHandlers = new Set<MessageHandler>();
  private stateChangeHandlers = new Set<StateChangeHandler>();
  private state: WsConnectionState = 'disconnected';
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  get connectionState(): WsConnectionState {
    return this.state;
  }

  get activeSubscriptions(): ReadonlySet<string> {
    return this.subscriptions;
  }

  async connect(): Promise<void> {
    if (this.state !== 'disconnected') return;

    const token = await getAccessToken();
    if (!token) return;

    const wsUrl = import.meta.env.VITE_WS_URL;
    if (!wsUrl) {
      console.error('[WsClient] VITE_WS_URL is not configured');
      return;
    }

    this.intentionalClose = false;
    this.setState('connecting');

    const url = `${wsUrl}?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setState('connected');
      this.restoreSubscriptions();
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as WsMessage;
        this.messageHandlers.forEach((handler) => handler(message));
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.setState('disconnected');

      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, triggering reconnect
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setState('disconnected');
  }

  subscribe(competitionId: string): boolean {
    if (this.subscriptions.size >= MAX_SUBSCRIPTIONS) {
      return false;
    }

    this.subscriptions.add(competitionId);

    if (this.state === 'connected' && this.ws) {
      this.ws.send(JSON.stringify({ action: 'subscribe', competitionId }));
    }

    return true;
  }

  unsubscribe(competitionId: string): void {
    this.subscriptions.delete(competitionId);

    if (this.state === 'connected' && this.ws) {
      this.ws.send(JSON.stringify({ action: 'unsubscribe', competitionId }));
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onStateChange(handler: StateChangeHandler): () => void {
    this.stateChangeHandlers.add(handler);
    return () => {
      this.stateChangeHandlers.delete(handler);
    };
  }

  private setState(newState: WsConnectionState): void {
    this.state = newState;
    this.stateChangeHandlers.forEach((handler) => handler(newState));
  }

  private restoreSubscriptions(): void {
    if (!this.ws || this.state !== 'connected') return;

    for (const competitionId of this.subscriptions) {
      this.ws.send(JSON.stringify({ action: 'subscribe', competitionId }));
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    const backoff = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(2, this.reconnectAttempt),
      MAX_BACKOFF_MS,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempt++;
      this.connect();
    }, backoff);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
