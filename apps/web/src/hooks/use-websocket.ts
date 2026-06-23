import { useEffect, useRef, useCallback } from 'react';
import { WsClient, type WsMessage } from '../lib/ws-client';
import { useWsStore } from '../stores/ws-store';
import { useAuthStore } from '../stores/auth-store';

let sharedClient: WsClient | null = null;

function getClient(): WsClient {
  if (!sharedClient) {
    sharedClient = new WsClient();
  }
  return sharedClient;
}

export function useWebSocket() {
  const { user } = useAuthStore();
  const { connectionState, subscriptions, latestEvents } = useWsStore();
  const {
    setConnectionState,
    addSubscription,
    removeSubscription,
    pushEvent,
  } = useWsStore();

  const clientRef = useRef<WsClient>(getClient());

  useEffect(() => {
    const client = clientRef.current;

    if (!user) {
      client.disconnect();
      return;
    }

    const unsubState = client.onStateChange((state) => {
      setConnectionState(state);
    });

    const unsubMsg = client.onMessage((message: WsMessage) => {
      pushEvent(message);
    });

    client.connect();

    return () => {
      unsubState();
      unsubMsg();
      client.disconnect();
    };
  }, [user, setConnectionState, pushEvent]);

  const subscribe = useCallback(
    (competitionId: string): boolean => {
      const client = clientRef.current;
      const success = client.subscribe(competitionId);
      if (success) {
        addSubscription(competitionId);
      }
      return success;
    },
    [addSubscription],
  );

  const unsubscribe = useCallback(
    (competitionId: string): void => {
      const client = clientRef.current;
      client.unsubscribe(competitionId);
      removeSubscription(competitionId);
    },
    [removeSubscription],
  );

  return {
    connectionState,
    subscriptions,
    latestEvents,
    subscribe,
    unsubscribe,
  };
}
