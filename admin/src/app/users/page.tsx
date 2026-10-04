"use client";

import Link from "next/link";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Badge, Button, Card, ErrorBox, Loading, Table, fmtDate, inputCls, statusTone } from "@/components/ui";
import { useAdmin } from "@/lib/hooks";
import type { UserCard } from "@/lib/types";

export default function UsersPage() {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const res = useAdmin<{ results: UserCard[] }>("/users", { enabled: term.length >= 3, query: { q: term } });
  return (
    <Shell title="Users" scope="users.read">
      <Card>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Exact email, user id (usr_…), plan id (pl_…) or Stripe customer" className={`${inputCls} flex-1`} aria-label="Search users" />
          <Button variant="primary" type="submit" icon="search">Search</Button>
        </form>
        <p className="mt-2 text-[12px] text-ink-3">Emails are matched by keyed hash, never stored in plain text. Health data stays masked until you reveal it with a reason.</p>
      </Card>
      <div className="mt-4">
        {!term ? null : res.isLoading ? <Loading /> : res.error ? <ErrorBox error={res.error} /> : (
          <Card title={`${res.data!.results.length} result(s)`}>
            <Table
              rows={res.data!.results}
              rowKey={(u) => u.id}
              empty="No account matches."
              cols={[
                { key: "e", label: "Account", render: (u) => <Link className="font-medium underline" href={`/users/${u.id}`}>{u.email_masked}</Link> },
                { key: "s", label: "Status", render: (u) => <Badge tone={statusTone(u.status)}>{u.status}</Badge> },
                { key: "t", label: "Tier", render: (u) => u.tier },
                { key: "c", label: "Consents", render: (u) => Object.entries(u.consents).filter(([, v]) => v).map(([k]) => k).join(", ") || "none" },
                { key: "l", label: "Last active", render: (u) => fmtDate(u.last_active_at) },
              ]}
            />
          </Card>
        )}
      </div>
    </Shell>
  );
}
