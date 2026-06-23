/**
 * Adapter Registry — resolves a DataProviderAdapter by `dataProviderId` (R16.4).
 *
 * Adapters are registered at startup and looked up when the Data Sync Service
 * needs to invoke a particular provider's operations for a competition.
 */

import type { DataProviderAdapter } from './adapter-interface.js';

const registry = new Map<string, DataProviderAdapter>();

/**
 * Register an adapter implementation for a given provider ID.
 * Overwrites any previously registered adapter for that ID.
 */
export function registerAdapter(adapter: DataProviderAdapter): void {
  registry.set(adapter.providerId, adapter);
}

/**
 * Retrieve the adapter for the given `dataProviderId`.
 * Throws if no adapter has been registered for that ID.
 */
export function getAdapter(dataProviderId: string): DataProviderAdapter {
  const adapter = registry.get(dataProviderId);
  if (!adapter) {
    throw new Error(
      `No DataProviderAdapter registered for provider "${dataProviderId}". ` +
        `Available providers: [${[...registry.keys()].join(', ')}]`
    );
  }
  return adapter;
}

/**
 * Remove a previously registered adapter. Returns true if it was present.
 */
export function unregisterAdapter(dataProviderId: string): boolean {
  return registry.delete(dataProviderId);
}

/**
 * List all currently registered provider IDs.
 */
export function listRegisteredProviders(): string[] {
  return [...registry.keys()];
}
