"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api";
import { useApp } from "./store";

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: Infinity, gcTime: Infinity });
}

/** Zustand's persisted state is only available after hydration on the client. */
export function useHydrated(): boolean {
  const [h, setH] = useState(false);
  useEffect(() => {
    if (useApp.persist.hasHydrated()) setH(true);
    return useApp.persist.onFinishHydration(() => setH(true));
  }, []);
  return h;
}

export function useEntitlements() {
  const token = useApp((s) => s.accessToken);
  return useQuery({
    queryKey: ["me", token],
    queryFn: api.me.get,
    enabled: Boolean(token),
    staleTime: 60_000,
  });
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
