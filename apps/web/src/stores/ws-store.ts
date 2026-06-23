import { create } from 'zustand';
import type { WsConnectionState, WsMessage } from '../lib/ws-client';

interface WsState {
  connectionState: WsConnectionState;
  subscriptions: Set<string>;
  latestEvents: WsMessage[];

  setConnectionState: (state: WsConnectionState) => void;
  addSubscription: (competitionId: string) => void;
  removeSubscription: (competitionId: string) => void;
  pushEvent: (event: WsMessage) => void;
  clearEvents: () => void;
}

const MAX_EVENTS = 100;

export const useWsStore = create<WsState>((set, get) => ({
  connectionState: 'disconnected',
  subscriptions: new Set<string>(),
  latestEvents: [],

  setConnectionState: (connectionState) => set({ connectionState }),

  addSubscription: (competitionId) => {
    const next = new Set(get().subscriptions);
    next.add(competitionId);
    set({ subscriptions: next });
  },

  removeSubscription: (competitionId) => {
    const next = new Set(get().subscriptions);
    next.delete(competitionId);
    set({ subscriptions: next });
  },

  pushEvent: (event) => {
    const current = get().latestEvents;
    const updated = [event, ...current].slice(0, MAX_EVENTS);
    set({ latestEvents: updated });
  },

  clearEvents: () => set({ latestEvents: [] }),
}));
