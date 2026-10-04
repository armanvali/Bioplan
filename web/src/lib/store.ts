"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { ExclusionAdded, User } from "./types";

// Browser storage can be unavailable (private windows, blocked site data). Fall back to memory.
const memory = new Map<string, string>();
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return memory.get(k) ?? null;
    }
  },
  setItem: (k, v) => {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      memory.set(k, v);
    }
  },
  removeItem: (k) => {
    try {
      window.localStorage.removeItem(k);
    } catch {
      memory.delete(k);
    }
  },
};

export interface Insight {
  signals: Record<string, number>; // latest probability per signal, from the server's signals_delta
  exclusions: ExclusionAdded[];
  confidence: number;
}

interface AppState {
  anonId: string;
  locale: "en" | "fr-CA";
  accessToken: string | null;
  user: User | null;
  sessionTokens: Record<string, string>;
  planTokens: Record<string, string>;
  insights: Record<string, Insight>;
  lastSessionId: string | null;
  lastPlanId: string | null;
  setLocale: (l: "en" | "fr-CA") => void;
  signIn: (token: string, user: User) => void;
  setUser: (user: User | null) => void;
  signOut: () => void;
  rememberSession: (id: string, token: string) => void;
  rememberPlan: (id: string, token: string) => void;
  updateInsight: (sessionId: string, fn: (prev: Insight) => Insight) => void;
  forgetDeviceData: () => void;
}

const emptyInsight: Insight = { signals: {}, exclusions: [], confidence: 0 };

function newAnonId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      anonId: newAnonId(),
      locale: "en",
      accessToken: null,
      user: null,
      sessionTokens: {},
      planTokens: {},
      insights: {},
      lastSessionId: null,
      lastPlanId: null,
      setLocale: (locale) => set({ locale }),
      signIn: (accessToken, user) => set({ accessToken, user }),
      setUser: (user) => set({ user }),
      signOut: () => set({ accessToken: null, user: null }),
      rememberSession: (id, token) => set((s) => ({ sessionTokens: { ...s.sessionTokens, [id]: token }, lastSessionId: id })),
      rememberPlan: (id, token) => set((s) => ({ planTokens: { ...s.planTokens, [id]: token }, lastPlanId: id })),
      updateInsight: (sessionId, fn) =>
        set((s) => ({ insights: { ...s.insights, [sessionId]: fn(s.insights[sessionId] ?? emptyInsight) } })),
      forgetDeviceData: () => set({ sessionTokens: {}, planTokens: {}, insights: {}, lastSessionId: null, lastPlanId: null }),
    }),
    {
      name: "stacksense",
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        anonId: s.anonId, locale: s.locale, accessToken: s.accessToken, user: s.user, sessionTokens: s.sessionTokens,
        planTokens: s.planTokens, insights: s.insights, lastSessionId: s.lastSessionId, lastPlanId: s.lastPlanId,
      }),
    },
  ),
);

export const insightFor = (s: AppState, sessionId: string): Insight => s.insights[sessionId] ?? emptyInsight;

/** Read the store outside React (the API client). */
export const appState = () => useApp.getState();
