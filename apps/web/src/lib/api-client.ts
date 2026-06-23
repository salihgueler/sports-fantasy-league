import type { ApiResponse } from '@fantasy/shared';
import { ApiClientError } from './api-error';
import { useAuthStore } from '../stores/auth-store';
import { refreshAccessToken } from './auth';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * Retrieve the current access token from the auth store — the single source of
 * truth set at sign-in (persisted under the `fantasy_auth` key). Returns null
 * when the user is not authenticated.
 */
function getAccessToken(): string | null {
  return useAuthStore.getState().tokens?.accessToken ?? null;
}

/**
 * Core fetch wrapper that adds auth, request-id, and parses the API envelope.
 * On 401, attempts a single token refresh and retries the original request.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const requestId = crypto.randomUUID();

  const doFetch = async (): Promise<Response> => {
    const token = getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-request-id': requestId,
      ...(options.headers as Record<string, string> | undefined),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
    });
  };

  let response = await doFetch();

  // On 401, try refreshing the token once and retry
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await doFetch();
    }
  }

  const json = (await response.json()) as ApiResponse<T>;

  if (json.success) {
    return json.data;
  }

  // Error envelope — throw a structured error
  throw new ApiClientError({
    code: json.error.code,
    message: json.error.message,
    details: json.error.details,
    requestId: json.meta.requestId,
  });
}

/**
 * Typed API client with methods for each HTTP verb.
 */
export const apiClient = {
  get<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'GET' });
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  },
};
