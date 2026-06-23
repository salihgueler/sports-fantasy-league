import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
  type QueryKey,
} from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import { ApiClientError } from '../lib/api-error';

/**
 * Typed GET query hook wrapping TanStack Query + apiClient.
 *
 * @param key - The query key (for caching/invalidation)
 * @param path - API path (e.g. "/competitions")
 * @param options - Additional TanStack Query options
 */
export function useApiQuery<TQueryFnData, TData = TQueryFnData>(
  key: QueryKey,
  path: string,
  options?: Omit<UseQueryOptions<TQueryFnData, ApiClientError, TData>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<TQueryFnData, ApiClientError, TData>({
    queryKey: key,
    queryFn: () => apiClient.get<TQueryFnData>(path),
    ...options,
  });
}

/**
 * Typed mutation hook for POST/PUT operations wrapping TanStack Query + apiClient.
 *
 * @param path - API path (e.g. "/teams")
 * @param method - HTTP method, defaults to POST
 * @param options - Additional TanStack Mutation options
 */
export function useApiMutation<TData, TVariables = unknown>(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE' = 'POST',
  options?: Omit<UseMutationOptions<TData, ApiClientError, TVariables>, 'mutationFn'>,
) {
  return useMutation<TData, ApiClientError, TVariables>({
    mutationFn: (variables: TVariables) => {
      switch (method) {
        case 'POST':
          return apiClient.post<TData>(path, variables);
        case 'PUT':
          return apiClient.put<TData>(path, variables);
        case 'DELETE':
          return apiClient.delete<TData>(path);
      }
    },
    ...options,
  });
}
