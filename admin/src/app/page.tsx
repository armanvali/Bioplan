"use client";

import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Badge, Card, Stat, Table, fmtDate, statusTone } from "@/components/ui";
import { can, useAuth } from "@/lib/api";
import { useAdmin } from "@/lib/hooks";
import type { Dashboards, Release } from "@/lib/types";

export default function Overview() {
  const admin = useAuth((s) => s.admin);
  const releases = useAdmin<{ releases: Release[] }>("/engine/releases", { enabled: can(admin, "engine.read") });
  const dash = useAdmin<Dashboards>("/revenue/dashboards", { enabled: can(admin, "dashboards.read") });
  const outbox = useAdmin<{ env: string; outbox: { id: number; channel: string; template: string; status: string; scheduled_for: string; error: string | null }[] }>("/ops/outbox", { enabled: can(admin, "settings.manage") });
  const waiting = releases.data?.releases.filter((r) => ["in_review", "approved", "checks_passed", "checks_failed"].includes(r.status)) ?? [];
  return (
    <Shell title={`Hello, ${admin?.name?.split(" ")[0] ?? ""}`}>
      <div className="grid gap-4">
        <p className="text-ink-2">
          You&apos;re signed in as <b>{admin?.role_label}</b>. You can: {admin?.scopes.join(", ")}.
        </p>
        {dash.data ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Completed intakes (30d)" value={dash.data.funnel.intake_completed} hint={`${dash.data.funnel.intake_started} started`} />
            <Stat label="Revenue / completed intake" value={`$${dash.data.revenue_per_completed_intake.toFixed(2)}`} />
            <Stat label="MRR" value={`$${dash.data.mrr.toFixed(2)}`} hint={`${dash.data.active_subscriptions} active subscriptions`} />
            <Stat label="Refund rate" value={`${(dash.data.refund_rate * 100).toFixed(1)}%`} />
          </div>
        ) : null}
        {can(admin, "engine.read") ? (
          <Card title="Releases needing attention" actions={<Link href="/engine" className="text-[13px] underline">All releases</Link>}>
            <Table
              rows={waiting}
              rowKey={(r) => r.id}
              empty="No releases waiting."
              cols={[
                { key: "v", label: "Version", render: (r) => <Link className="font-medium underline" href={`/engine/${r.id}`}>{r.version}</Link> },
                { key: "k", label: "Kind", render: (r) => r.kind },
                { key: "s", label: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
                { key: "c", label: "Created", render: (r) => fmtDate(r.created_at) },
              ]}
            />
          </Card>
        ) : null}
        {outbox.data ? (
          <Card title={`Outbox (${outbox.data.env})`}>
            <Table
              rows={outbox.data.outbox.slice(0, 10)}
              rowKey={(r) => r.id}
              cols={[
                { key: "t", label: "Template", render: (r) => r.template },
                { key: "c", label: "Channel", render: (r) => r.channel },
                { key: "s", label: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
                { key: "w", label: "Scheduled", render: (r) => fmtDate(r.scheduled_for) },
                { key: "e", label: "Error", render: (r) => r.error ?? "" },
              ]}
            />
          </Card>
        ) : null}
      </div>
    </Shell>
  );
}
