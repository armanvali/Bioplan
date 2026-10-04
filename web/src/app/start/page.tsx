"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { ErrorNote, Loading } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useHydrated } from "@/lib/hooks";
import { useApp } from "@/lib/store";

function Starter() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const remember = useApp((s) => s.rememberSession);
  const updateInsight = useApp((s) => s.updateInsight);
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);

  const start = async () => {
    setError(null);
    try {
      // ?date=YYYY-MM-DD pins "today" for demos and tests (the season and ramp-up depend on it).
      const created = await api.intake.create(params.get("date") ?? undefined);
      remember(created.session_id, created.session_token);
      updateInsight(created.session_id, () => ({ signals: {}, exclusions: [], confidence: created.confidence }));
      qc.setQueryData(["session", created.session_id], {
        session_id: created.session_id, status: "active", step: created.next, confidence: created.confidence, returning: created.returning,
      });
      router.replace(`/intake/${created.session_id}`);
    } catch (e) {
      setError(e);
    }
  };

  useEffect(() => {
    if (!hydrated || started.current) return;
    started.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  return error ? <ErrorNote error={error} onRetry={start} /> : <Loading label="Setting up your intake…" />;
}

export default function StartPage() {
  return (
    <>
      <AppHeader minimal />
      <main id="main" className="mx-auto max-w-xl px-4 py-10">
        <Suspense fallback={<Loading />}>
          <Starter />
        </Suspense>
      </main>
    </>
  );
}
