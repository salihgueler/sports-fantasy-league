import { create } from 'zustand';

export interface AuthUser {
  userId: string;
  email: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms when the access token expires
}

interface AuthState {
  user: AuthUser | null;
  tokens: TokenPair | null;
  loading: boolean;
  setAuth: (user: AuthUser, tokens: TokenPair) => void;
  setTokens: (tokens: TokenPair) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

const STORAGE_KEY = 'fantasy_auth';

function loadPersistedAuth(): { user: AuthUser | null; tokens: TokenPair | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null, tokens: null };
    const parsed = JSON.parse(raw);
    if (parsed.tokens && parsed.tokens.expiresAt < Date.now()) {
      // Access token expired — we'll try to refresh on app boot
      return { user: parsed.user ?? null, tokens: parsed.tokens };
    }
    return { user: parsed.user ?? null, tokens: parsed.tokens ?? null };
  } catch {
    return { user: null, tokens: null };
  }
}

function persistAuth(user: AuthUser | null, tokens: TokenPair | null) {
  if (!user || !tokens) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, tokens }));
}

export const useAuthStore = create<AuthState>((set, get) => {
  const persisted = loadPersistedAuth();

  return {
    user: persisted.user,
    tokens: persisted.tokens,
    loading: false,

    setAuth: (user, tokens) => {
      persistAuth(user, tokens);
      set({ user, tokens });
    },

    setTokens: (tokens) => {
      const { user } = get();
      persistAuth(user, tokens);
      set({ tokens });
    },

    setLoading: (loading) => set({ loading }),

    logout: () => {
      persistAuth(null, null);
      set({ user: null, tokens: null });
    },
  };
});
