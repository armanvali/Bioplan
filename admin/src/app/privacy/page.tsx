"use client";

import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Badge, Button, Card, ErrorBox, Loading, Table, fmtDate, inputCls, statusTone } from "@/components/ui";
import { adminApi } from "@/lib/api";
import { useAdmin, useAdminWrite } from "@/lib/hooks";

interface Req { id: string; user_id: string; type: string; status: string; created_at: string; due_at?: string | null; completed_at: string | null; notes?: string | null }

export default function PrivacyQueue() {
  const [status, setStatus] = useState("");
  const q = useAdmin<{ requests: Req[] }>("/privacy-requests", { query: { status: status || undefined } });
  const fulfil = useAdminWrite((id: string) => adminApi(`/privacy-requests/${id}/fulfil`, { method: "POST" }));
  return (
    <Shell title="Privacy requests" scope="privacy.queue">
      <Card
        title="Queue"
        actions={
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls} aria-label="Filter by status">
            <option value="">All</option><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="completed">Completed</option>
          </select>
        }
      >
        <p className="mb-3 text-[12px] text-ink-3">Most exports and deletions complete instantly in self-service. Requests that arrive by email land here; the legal deadline is 30 days.</p>
        {fulfil.error ? <ErrorBox error={fulfil.error} /> : null}
        {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : (
          <Table
            rows={q.data!.requests}
            rowKey={(r) => r.id}
            empty="The queue is empty."
            cols={[
              { key: "t", label: "Type", render: (r) => r.type },
              { key: "u", label: "User", render: (r) => <span className="font-mono text-[12px]">{r.user_id}</span> },
              { key: "s", label: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
              { key: "c", label: "Received", render: (r) => fmtDate(r.created_at) },
              { key: "d", label: "Done", render: (r) => fmtDate(r.completed_at) },
              { key: "a", label: "", render: (r) => (r.status !== "completed" ? <Button variant="primary" busy={fulfil.isPending && fulfil.variables === r.id} onClick={() => fulfil.mutate(r.id)}>Fulfil</Button> : null) },
            ]}
          />
        )}
      </Card>
    </Shell>
  );
}
