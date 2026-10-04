"use client";

import { LinkButton } from "@/components/ui/primitives";
import { useHydrated } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { useApp } from "@/lib/store";

export function HomeCta() {
  const t = useT();
  const hydrated = useHydrated();
  const lastSessionId = useApp((s) => s.lastSessionId);
  const lastPlanId = useApp((s) => s.lastPlanId);
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      <LinkButton href="/start" icon="right">
        {t("cta.start")}
      </LinkButton>
      {hydrated && lastPlanId ? (
        <LinkButton href={`/plan/${lastPlanId}`} variant="secondary">
          {t("cta.seePlan")}
        </LinkButton>
      ) : hydrated && lastSessionId ? (
        <LinkButton href={`/intake/${lastSessionId}`} variant="secondary">
          {t("cta.resume")}
        </LinkButton>
      ) : null}
    </div>
  );
}
