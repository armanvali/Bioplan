"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "./api";

/** GET an admin endpoint. `key` doubles as the path unless a path is given. */
export function useAdmin<T>(path: string, opts: { enabled?: boolean; query?: Record<string, string | number | undefined> } = {}) {
  return useQuery<T>({
    queryKey: ["admin", path, opts.query ?? {}],
    queryFn: () => adminApi<T>(path, { query: opts.query }),
    enabled: opts.enabled ?? true,
  });
}

/** A write that refreshes every admin query afterwards (writes are rare; correctness beats cleverness). */
export function useAdminWrite<TArgs, TOut = unknown>(fn: (args: TArgs) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }) });
}
