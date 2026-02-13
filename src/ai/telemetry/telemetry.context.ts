import { AsyncLocalStorage } from 'async_hooks';

export interface TelemetryContext {
  organizationId?: string;
  userId?: string;
  ticketId?: string;
  feature?: string;
}

/**
 * Global storage for AI telemetry context.
 * Allows us to track which organization/user is responsible for an AI call
 * without passing context objects through every service function.
 */
export const telemetryStorage = new AsyncLocalStorage<TelemetryContext>();

/**
 * Helper to get the current telemetry context or a default empty one
 */
export function getTelemetryContext(): TelemetryContext {
  return telemetryStorage.getStore() || {};
}

/**
 * Helper to run a function within a specific telemetry context
 */
export function runWithTelemetryContext<T>(
  context: TelemetryContext,
  fn: () => T,
): T {
  const currentContext = getTelemetryContext();
  // Merge context to allow nested overrides
  return telemetryStorage.run({ ...currentContext, ...context }, fn);
}
