"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { can, useAuth } from "@/lib/api";
import { Icon } from "./Icon";

export const NAV: { href: string; label: string; icon: string; scope: string }[] = [
  { href: "/", label: "Overview", icon: "grid", scope: "" },
  { href: "/engine", label: "Engine releases", icon: "flask", scope: "engine.read" },
  { href: "/engine/simulator", label: "Simulator", icon: "sparkle", scope: "engine.simulate" },
  { href: "/engine/knowledge", label: "Knowledge & graph", icon: "list", scope: "engine.read" },
  { href: "/users", label: "Users", icon: "user", scope: "users.read" },
  { href: "/privacy", label: "Privacy queue", icon: "shield", scope: "privacy.queue" },
  { href: "/catalog", label: "Catalog", icon: "cart", scope: "catalog.read" },
  { href: "/revenue", label: "Revenue", icon: "bars", scope: "revenue.read" },
  { href: "/analytics", label: "Analytics", icon: "radar", scope: "dashboards.read" },
  { href: "/audit", label: "Audit log", icon: "doc", scope: "audit.read" },
  { href: "/staff", label: "Staff & roles", icon: "user", scope: "staff.manage" },
];

export function useRequireAdmin() {
  const router = useRouter();
  const token = useAuth((s) => s.token);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const done = () => setReady(true);
    if (useAuth.persist.hasHydrated()) done();
    return useAuth.persist.onFinishHydration(done);
  }, []);
  useEffect(() => {
    if (ready && !token) router.replace("/login");
  }, [ready, token, router]);
  return ready && Boolean(token);
}

export function Shell({ children, title, scope, actions }: { children: ReactNode; title: string; scope?: string; actions?: ReactNode }) {
  const ok = useRequireAdmin();
  const admin = useAuth((s) => s.admin);
  const signOut = useAuth((s) => s.signOut);
  const path = usePathname();
  if (!ok) return null;
  const allowed = !scope || can(admin, scope);
  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="border-b border-line bg-surface md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="grid size-7 place-items-center rounded-lg bg-ink text-white"><Icon name="shield" size={16} /></span>
          <span className="display text-base">StackSense <span className="font-sans text-xs text-ink-3">admin</span></span>
        </div>
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-2 pb-2 md:grid md:pb-4">
          {NAV.filter((n) => !n.scope || can(admin, n.scope)).map((n) => {
            const on = n.href === "/" ? path === "/" : path === n.href || (path?.startsWith(n.href + "/") && !NAV.some((m) => m.href !== n.href && m.href.startsWith(n.href) && path.startsWith(m.href)));
            return (
              <Link key={n.href} href={n.href} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${on ? "bg-sunken font-semibold text-ink" : "text-ink-2 hover:bg-canvas"}`}>
                <Icon name={n.icon} size={16} /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden border-t border-line px-4 py-3 text-[12px] md:block">
          <p className="font-semibold">{admin?.name}</p>
          <p className="text-ink-3">{admin?.role_label}</p>
          <button className="mt-2 text-ink-2 underline" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main id="main" className="min-w-0 p-4 md:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="display text-2xl">{title}</h1>
          <div className="flex flex-wrap gap-2">{allowed ? actions : null}</div>
        </div>
        {allowed ? children : (
          <div className="card p-6 text-ink-2">Your role ({admin?.role_label}) doesn&apos;t include <code>{scope}</code>. Ask a super admin if you need it.</div>
        )}
      </main>
    </div>
  );
}
