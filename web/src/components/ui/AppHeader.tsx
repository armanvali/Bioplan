"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { useApp } from "@/lib/store";
import { Icon } from "./Icon";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="StackSense home">
      <span className="grid size-8 place-items-center rounded-[10px] bg-ink text-white">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 17h16M6 12h12M8 7h8" />
        </svg>
      </span>
      <span className="display text-lg">StackSense</span>
    </Link>
  );
}

export function AppHeader({ minimal = false }: { minimal?: boolean }) {
  const t = useT();
  const path = usePathname();
  const user = useApp((s) => s.user);
  const lastPlanId = useApp((s) => s.lastPlanId);
  const locale = useApp((s) => s.locale);
  const setLocale = useApp((s) => s.setLocale);
  const [online, setOnline] = useState(true);
  // Persisted state only exists in the browser; render signed-out markup until hydrated.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={`rounded-full px-3 py-2 text-sm font-medium ${path?.startsWith(href) ? "bg-surface text-ink shadow-[var(--shadow-1)]" : "text-ink-2 hover:text-ink"}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4">
          <Logo />
          {!minimal ? (
            <nav className="flex items-center gap-1" aria-label="Main">
              {hydrated && lastPlanId ? link(`/plan/${lastPlanId}`, t("nav.plan")) : null}
              <span className="hidden sm:inline">{link("/pricing", t("nav.pricing"))}</span>
              {hydrated && user ? (
                link("/account", t("nav.account"))
              ) : (
                <Link href="/account" className="rounded-full px-3 py-2 text-sm font-medium text-ink-2 hover:text-ink">
                  {t("nav.signin")}
                </Link>
              )}
              <button
                onClick={() => setLocale(locale === "en" ? "fr-CA" : "en")}
                className="rounded-full px-2 py-2 text-xs font-semibold text-ink-3 hover:text-ink"
                aria-label={locale === "en" ? "Passer au français" : "Switch to English"}
              >
                {hydrated && locale === "fr-CA" ? "EN" : "FR"}
              </button>
            </nav>
          ) : null}
        </div>
      </header>
      {!online ? (
        <div role="status" className="flex items-center justify-center gap-2 bg-amber-tint px-4 py-2 text-sm text-amber-ink">
          <Icon name="alert" size={16} /> {t("common.offline")}
        </div>
      ) : null}
    </>
  );
}

export function Footer() {
  return (
    <footer className="mx-auto max-w-5xl px-4 pb-10 pt-8 text-xs leading-relaxed text-ink-3">
      <p>
        StackSense gives general information, not medical advice. Talk to a doctor or pharmacist before starting supplements, especially if you
        take medication, are pregnant, or have a health condition.
      </p>
      <p className="mt-2">
        <Link href="/pricing" className="underline">Pricing</Link> · <Link href="/account/privacy" className="underline">Privacy</Link> ·{" "}
        We may earn a commission when you buy through our links. It never changes what we recommend.
      </p>
    </footer>
  );
}
