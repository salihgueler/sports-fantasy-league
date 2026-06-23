import { useAuthStore, type AuthUser, type TokenPair } from '../stores/auth-store';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: { requestId: string; timestamp: string };
}

interface ApiError {
  success: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
  meta: { requestId: string; timestamp: string };
}

type ApiResponse<T> = ApiSuccess<T> | ApiError;

export class AuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AuthError';
  }
}

async function authFetch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as ApiResponse<T>;

  if (!json.success) {
    throw new AuthError(json.error.code, json.error.message);
  }

  return json.data;
}

export interface SignInResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  user: { userId: string; email: string };
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number; // seconds
}

export async function register(
  email: string,
  password: string,
  displayName: string,
): Promise<void> {
  await authFetch<{ message: string }>('/auth/register', { email, password, displayName });
}

export async function signIn(email: string, password: string): Promise<void> {
  const data = await authFetch<SignInResponse>('/auth/sign-in', { email, password });

  const tokens: TokenPair = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + data.expiresIn * 1000,
  };

  const user: AuthUser = { userId: data.user.userId, email: data.user.email };
  useAuthStore.getState().setAuth(user, tokens);
}

export async function verifyEmail(email: string, code: string): Promise<void> {
  await authFetch<{ message: string }>('/auth/verify', { email, code });
}

export async function refreshAccessToken(): Promise<boolean> {
  const { tokens } = useAuthStore.getState();
  if (!tokens?.refreshToken) return false;

  try {
    const data = await authFetch<RefreshResponse>('/auth/refresh', {
      refreshToken: tokens.refreshToken,
    });

    const updatedTokens: TokenPair = {
      accessToken: data.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + data.expiresIn * 1000,
    };

    useAuthStore.getState().setTokens(updatedTokens);
    return true;
  } catch {
    useAuthStore.getState().logout();
    return false;
  }
}

export function logout(): void {
  useAuthStore.getState().logout();
}

// Automatic token refresh: schedule a refresh 1 minute before expiry
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleTokenRefresh(): void {
  clearScheduledRefresh();

  const { tokens } = useAuthStore.getState();
  if (!tokens) return;

  const msUntilExpiry = tokens.expiresAt - Date.now();
  // Refresh 60 seconds before expiry, or immediately if already near expiry
  const delay = Math.max(msUntilExpiry - 60_000, 0);

  refreshTimer = setTimeout(async () => {
    const success = await refreshAccessToken();
    if (success) {
      scheduleTokenRefresh();
    }
  }, delay);
}

export function clearScheduledRefresh(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

// Utility to get the current access token, refreshing if needed
export async function getAccessToken(): Promise<string | null> {
  const { tokens } = useAuthStore.getState();
  if (!tokens) return null;

  // If token is expired or will expire within 30 seconds, refresh
  if (tokens.expiresAt - Date.now() < 30_000) {
    const success = await refreshAccessToken();
    if (!success) return null;
    return useAuthStore.getState().tokens?.accessToken ?? null;
  }

  return tokens.accessToken;
}
