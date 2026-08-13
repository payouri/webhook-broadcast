import { QueryClient } from "@tanstack/react-query";

/**
 * Query client factory (ADR 0004). Retries are disabled — the dashboard
 * surfaces already show a manual Retry control (InlineLoadError) on failure,
 * and automatic retries would both delay that feedback and add extra requests
 * underneath the ~5s `refetchInterval` polling. Tests build their own isolated
 * client from this factory so they share the app's options.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

/** App-wide client — one per browser session. */
export const queryClient = createQueryClient();
