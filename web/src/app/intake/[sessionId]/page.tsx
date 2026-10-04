"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BranchToast, ConfidenceRing, ConfirmCard, InsightRail, ReturningUserBanner, StopCard } from "@/components/intake/IntakeParts";
import { QuestionCard } from "@/components/intake/QuestionCard";
import { AppHeader } from "@/components/ui/AppHeader";
import { Icon } from "@/components/ui/Icon";
import { Button, ErrorNote, Loading, LinkButton, Sheet } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api";
import { useHydrated, useMeta } from "@/lib/hooks";
import { insightFor, useApp } from "@/lib/store";
import type { AnswerResponse, AnswerValue, Step, Toast } from "@/lib/types";

type SessionView = { session_id: string; status: string; step: Step; confidence: number; returning?: boolean };

export default function IntakePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const token = useApp((s) => s.sessionTokens[sessionId]);
  const insight = useApp((s) => insightFor(s, sessionId));
  const updateInsight = useApp((s) => s.updateInsight);
  const { data: meta } = useMeta();

  const session = useQuery<SessionView>({
    queryKey: ["session", sessionId],
    queryFn: () => api.intake.get(sessionId),
    enabled: hydrated && Boolean(token),
    staleTime: Infinity,
  });

  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [freeText, setFreeText] = useState<{ nodeId: string; text: string; mappings: { signal_id: string; confidence: number; quote: string; on: boolean }[] } | null>(null);

  const step = session.data?.step;

  useEffect(() => {
    if (step?.kind === "review") router.replace(`/intake/${sessionId}/review`);
  }, [step?.kind, router, sessionId]);

  const setStep = (next: Step, confidence?: number): void => {
    qc.setQueryData<SessionView>(["session", sessionId], (old) => (old ? { ...old, step: next, confidence: confidence ?? old.confidence } : old));
  };

  const applyAnswer = (res: AnswerResponse) => {
    updateInsight(sessionId, (prev) => {
      const signals = { ...prev.signals };
      for (const d of res.signals_delta) signals[d.signal] = d.p;
      const seen = new Set(prev.exclusions.map((e) => e.ingredient));
      return { signals, exclusions: [...prev.exclusions, ...res.exclusions_added.filter((e) => !seen.has(e.ingredient))], confidence: res.confidence };
    });
    if (res.toast) setToast(res.toast);
    setStep(res.next, res.confidence);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const answer = (nodeId: string, value: AnswerValue) =>
    run(async () => {
      // Free text goes through the bounded mapper first; the person confirms what we understood.
      if (step?.kind === "node" && step.node.answer.type === "free_text" && typeof value.text === "string" && value.text.trim()) {
        const m = await api.intake.freeText(sessionId, value.text);
        if (m.mappings.length) {
          setFreeText({ nodeId, text: value.text, mappings: m.mappings.map((x) => ({ ...x, on: !x.needs_confirmation && x.confidence >= 0.75 })) });
          return;
        }
      }
      applyAnswer(await api.intake.answer(sessionId, nodeId, value));
    });

  const confirmFreeText = () =>
    freeText &&
    run(async () => {
      const mapped = freeText.mappings.filter((m) => m.on).map(({ signal_id, confidence, quote }) => ({ signal_id, confidence, quote, confirmed: true }));
      setFreeText(null);
      applyAnswer(await api.intake.answer(sessionId, freeText.nodeId, { text: freeText.text, mapped }));
    });

  if (!hydrated) return <Shell><Loading /></Shell>;
  if (!token) {
    return (
      <Shell>
        <div className="card p-6">
          <h1 className="display text-2xl">This intake lives on another device</h1>
          <p className="mt-2 text-ink-2">For your privacy, an intake can only be continued on the device where it started (or after you save it to your account).</p>
          <div className="mt-5 flex gap-3">
            <LinkButton href="/start">Start a new intake</LinkButton>
            <LinkButton href="/account" variant="secondary">Sign in</LinkButton>
          </div>
        </div>
      </Shell>
    );
  }
  if (session.isError) return <Shell><ErrorNote error={session.error} onRetry={() => session.refetch()} /></Shell>;
  if (!step || step.kind === "review") return <Shell><Loading /></Shell>;

  const answered = step.progress.answered;

  return (
    <Shell>
      <BranchToast toast={toast} />
      <div className="mb-4 flex items-center justify-between gap-3 lg:hidden">
        <button onClick={() => setRailOpen(true)} className="flex items-center gap-3 rounded-full bg-surface py-1 pl-1 pr-4 shadow-[var(--shadow-1)]" aria-label="What we're hearing">
          <ConfidenceRing value={insight.confidence} size={40} />
          <span className="text-sm text-ink-2">
            {Object.values(insight.signals).filter((p) => p >= 0.5).length} patterns · {insight.exclusions.length} ruled out
          </span>
        </button>
        {answered >= 10 && step.kind === "node" && step.node.phase === "preferences" ? <FinishEarly sessionId={sessionId} onStep={setStep} /> : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">
          {session.data?.returning && step.kind === "confirm" ? <ReturningUserBanner /> : null}
          {step.kind === "node" ? (
            <QuestionCard
              node={step.node}
              progress={step.progress}
              busy={busy}
              error={error}
              onAnswer={(v) => answer(step.node.id, v)}
              onBack={answered > 0 ? () => run(async () => setStep((await api.intake.back(sessionId)).next)) : undefined}
              onRephrase={async () => {
                try {
                  const r = await api.intake.rephrase(sessionId, step.node.id);
                  return r.source === "approved" ? null : r;
                } catch {
                  return null;
                }
              }}
            />
          ) : step.kind === "confirm" ? (
            <ConfirmCard node={step.node} busy={busy} onSubmit={(changed) => answer(step.node.id, { changed })} />
          ) : step.kind === "stop" ? (
            <StopCard card={step.card} busy={busy} onContinue={step.card.can_continue ? () => run(async () => setStep((await api.intake.acknowledge(sessionId, step.card.id)).next)) : undefined} />
          ) : null}
          {step.kind === "stop" && !step.card.can_continue ? (
            <p className="text-center text-sm text-ink-3">
              <Link href="/" className="underline">Back to the start</Link>
            </p>
          ) : null}
        </div>
        <div className="hidden lg:block">
          <div className="sticky top-20 grid gap-4">
            <InsightRail signals={insight.signals} exclusions={insight.exclusions} confidence={insight.confidence} />
            {answered >= 10 && step.kind === "node" && step.node.phase === "preferences" ? <FinishEarly sessionId={sessionId} onStep={setStep} /> : null}
          </div>
        </div>
      </div>

      <Sheet open={railOpen} onClose={() => setRailOpen(false)} title="What we're hearing">
        <InsightRail signals={insight.signals} exclusions={insight.exclusions} confidence={insight.confidence} />
      </Sheet>

      <Sheet open={Boolean(freeText)} onClose={() => setFreeText(null)} title="Did we get that right?">
        {freeText ? (
          <div className="grid gap-3">
            <p className="text-[15px] text-ink-2">Tick what applies. We&apos;ll only use what you confirm.</p>
            {freeText.mappings.map((m, i) => (
              <label key={m.signal_id} className="flex items-start gap-3 rounded-[12px] border border-line-2 p-3">
                <input
                  type="checkbox"
                  checked={m.on}
                  onChange={(e) => setFreeText({ ...freeText, mappings: freeText.mappings.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) })}
                  className="mt-1 size-5 accent-[var(--color-sage)]"
                />
                <span>
                  <span className="block font-medium">{meta?.signals[m.signal_id]?.label ?? m.signal_id.replace(/_/g, " ")}</span>
                  <span className="block text-sm text-ink-3">From: &ldquo;{m.quote}&rdquo;</span>
                </span>
              </label>
            ))}
            <Button onClick={confirmFreeText} busy={busy}>
              Continue
            </Button>
          </div>
        ) : null}
      </Sheet>
    </Shell>
  );
}

function FinishEarly({ sessionId, onStep }: { sessionId: string; onStep: (s: Step) => void }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <button
      className="inline-flex items-center gap-1 text-sm font-medium text-sage-ink disabled:opacity-50"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api.intake.finish(sessionId);
          onStep(r.next);
          if (r.next.kind === "review") router.push(`/intake/${sessionId}/review`);
        } finally {
          setBusy(false);
        }
      }}
    >
      Show my results now <Icon name="right" size={16} />
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
        {children}
      </main>
    </>
  );
}
