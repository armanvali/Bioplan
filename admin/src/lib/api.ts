"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Empty string = same origin: Next forwards /admin/v1 to the API (API_PROXY_TARGET in next.config.ts).
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export interface Admin {
  id: string;
  email: string;
  name: string;
  role: string;
  role_label: string;
  scopes: string[];
}

interface AuthState {
  token: string | null;
  admin: Admin | null;
  expiresAt: number | null;
  signIn: (token: string, admin: Admin, expiresIn: number) => void;
  signOut: () => void;
}

// Staff sessions live in sessionStorage: closing the browser signs you out (section 15.2).
export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      admin: null,
      expiresAt: null,
      signIn: (token, admin, expiresIn) => set({ token, admin, expiresAt: Date.now() + expiresIn * 1000 }),
      signOut: () => set({ token: null, admin: null, expiresAt: null }),
    }),
    {
      name: "stacksense-admin",
      storage: createJSONStorage(() => {
        try {
          return window.sessionStorage;
        } catch {
          const mem = new Map<string, string>();
          return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
        }
      }),
    },
  ),
);

export const can = (admin: Admin | null, scope: string) => Boolean(admin?.scopes.includes(scope));

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

type Query = Record<string, string | number | undefined | null>;

export async function adminApi<T>(path: string, opts: { method?: string; body?: unknown; query?: Query; text?: boolean } = {}): Promise<T> {
  const { token, expiresAt, signOut } = useAuth.getState();
  if (token && expiresAt && Date.now() > expiresAt) signOut();
  const u = new URL(`${API_URL}/admin/v1${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(u, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(useAuth.getState().token ? { Authorization: `Bearer ${useAuth.getState().token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "offline", "Can't reach the API.");
  }
  if (!res.ok) {
    let err: { code?: string; message?: string; details?: Record<string, unknown> } = {};
    try {
      const j = await res.json();
      err = j.error ?? { message: typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail) };
    } catch {
      /* not JSON */
    }
    if (res.status === 401) useAuth.getState().signOut();
    throw new ApiError(res.status, err.code ?? `http_${res.status}`, err.message ?? res.statusText, err.details ?? {});
  }
  return (opts.text ? await res.text() : await res.json()) as T;
}
