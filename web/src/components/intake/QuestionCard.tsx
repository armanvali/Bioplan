"use client";

import { useEffect, useState } from "react";
import { canSubmit, initialValue, PHASE_LABELS, rawAnswer } from "@/lib/intake";
import { useT } from "@/lib/i18n";
import type { AnswerValue, Progress, QuestionNode } from "@/lib/types";
import { Icon } from "../ui/Icon";
import { Button } from "../ui/primitives";
import { AnswerControls } from "./AnswerControls";

export function QuestionCard({
  node, progress, onAnswer, onBack, onRephrase, busy, error,
}: {
  node: QuestionNode;
  progress: Progress;
  onAnswer: (value: AnswerValue) => void;
  onBack?: () => void;
  onRephrase?: () => Promise<{ prompt: string; helper: string } | null>;
  busy?: boolean;
  error?: string | null;
}) {
  const t = useT();
  const [value, setValue] = useState<AnswerValue>(() => initialValue(node));
  const [whyOpen, setWhyOpen] = useState(false);
  const [simple, setSimple] = useState<{ prompt: string; helper: string } | null>(null);

  useEffect(() => {
    setValue(initialValue(node));
    setWhyOpen(false);
    setSimple(null);
  }, [node]);

  const ok = canSubmit(node.answer, value);
  const submit = () => ok && !busy && onAnswer(rawAnswer(node.answer, value));
  const total = Math.max(progress.estimated_total, progress.answered + 1);

  return (
    <section className="card animate-rise p-5 sm:p-7" aria-labelledby={`q-${node.id}`} key={node.id} data-node-id={node.id}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="eyebrow">{PHASE_LABELS[node.phase] ?? node.phase}</p>
        <p className="text-xs text-ink-3" aria-live="polite">
          {t("intake.questionOf", { n: progress.answered + 1, total })}
        </p>
      </div>
      <div className="mb-5 h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div className="h-full rounded-full bg-sage transition-[width] duration-500" style={{ width: `${Math.min(100, (progress.answered / total) * 100)}%` }} />
      </div>

      <h1 id={`q-${node.id}`} className="display text-2xl leading-tight sm:text-[28px]">
        {simple?.prompt ?? node.prompt}
      </h1>
      {(simple?.helper ?? node.helper) ? <p className="mt-2 text-[15px] text-ink-2">{simple?.helper ?? node.helper}</p> : null}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {node.why ? (
          <button type="button" onClick={() => setWhyOpen((o) => !o)} aria-expanded={whyOpen} className="inline-flex items-center gap-1 text-sm font-medium text-sage-ink">
            <Icon name="info" size={16} /> {t("intake.why")}
          </button>
        ) : null}
        {onRephrase && !simple ? (
          <button
            type="button"
            onClick={async () => setSimple(await onRephrase())}
            className="inline-flex items-center gap-1 text-sm font-medium text-ink-3 hover:text-ink"
          >
            <Icon name="sparkle" size={16} /> Say it more simply
          </button>
        ) : null}
      </div>
      {whyOpen ? <p className="mt-2 animate-rise rounded-[10px] bg-sage-tint p-3 text-sm text-sage-ink">{node.why}</p> : null}

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <AnswerControls schema={node.answer} value={value} onChange={setValue} />

        {error ? (
          <p role="alert" className="mt-4 rounded-[10px] bg-caution-tint p-3 text-sm text-caution-ink">
            {error}
          </p>
        ) : null}

        <div className="sticky bottom-0 -mx-5 mt-6 flex items-center gap-2 border-t border-line bg-surface/95 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          {onBack ? (
            <Button type="button" variant="ghost" icon="back" onClick={onBack} disabled={busy} aria-label={t("cta.back")}>
              <span className="hidden sm:inline">{t("cta.back")}</span>
            </Button>
          ) : null}
          <span className="flex-1" />
          {node.answer.allow_unsure ? (
            <Button type="button" variant="secondary" onClick={() => onAnswer({ unsure: true })} disabled={busy}>
              {t("cta.unsure")}
            </Button>
          ) : null}
          {node.answer.type === "free_text" ? (
            <Button type="button" variant="secondary" onClick={() => onAnswer({ skip: true })} disabled={busy}>
              {t("cta.skip")}
            </Button>
          ) : null}
          <Button type="submit" disabled={!ok} busy={busy}>
            {t("cta.continue")}
          </Button>
        </div>
      </form>
    </section>
  );
}
