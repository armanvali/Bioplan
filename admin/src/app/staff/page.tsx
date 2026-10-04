"use client";

import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Badge, Button, Card, ErrorBox, Field, Loading, Modal, Table, fmtDate, inputCls } from "@/components/ui";
import { adminApi, type Admin } from "@/lib/api";
import { useAdmin, useAdminWrite } from "@/lib/hooks";

interface StaffResp {
  staff: (Admin & { active: boolean; last_login_at: string | null })[];
  roles: Record<string, { label: string; scopes: string[]; cannot: string }>;
  scopes: Record<string, string>;
}

export default function StaffPage() {
  const staff = useAdmin<StaffResp>("/staff");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "support_agent" });
  const [created, setCreated] = useState<{ totp_uri: string } | null>(null);
  const add = useAdminWrite((f: typeof form) => adminApi<{ admin: Admin; totp_uri: string }>("/staff", { body: f }));
  const setRole = useAdminWrite(({ id, role }: { id: string; role: string }) => adminApi(`/staff/${id}/role`, { method: "PUT", body: { role } }));
  return (
    <Shell title="Staff & roles" scope="staff.manage" actions={<Button variant="primary" icon="plus" onClick={() => { setCreated(null); setOpen(true); }}>Add staff</Button>}>
      {staff.isLoading ? <Loading /> : staff.error ? <ErrorBox error={staff.error} /> : (
        <div className="grid gap-4">
          <Card title="Staff">
            {setRole.error ? <ErrorBox error={setRole.error} /> : null}
            <Table
              rows={staff.data!.staff}
              rowKey={(s) => s.id}
              cols={[
                { key: "n", label: "Name", render: (s) => <span><b className="font-medium">{s.name}</b><br /><span className="text-[11px] text-ink-3">{s.email}</span></span> },
                {
                  key: "r", label: "Role", render: (s) => (
                    <select className={inputCls} value={s.role} onChange={(e) => setRole.mutate({ id: s.id, role: e.target.value })} aria-label={`Role for ${s.name}`}>
                      {Object.entries(staff.data!.roles).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  ),
                },
                { key: "a", label: "Status", render: (s) => <Badge tone={s.active ? "green" : "grey"}>{s.active ? "active" : "disabled"}</Badge> },
                { key: "l", label: "Last sign-in", render: (s) => fmtDate(s.last_login_at) },
              ]}
            />
          </Card>
          <Card title="Roles (least privilege)">
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(staff.data!.roles).map(([k, r]) => (
                <div key={k} className="rounded-lg border border-line p-3 text-[13px]">
                  <p className="font-semibold">{r.label}</p>
                  <p className="mt-1 text-ink-2">{r.scopes.map((s) => staff.data!.scopes[s] ?? s).join(" · ")}</p>
                  <p className="mt-1 text-[12px] text-caution-ink">Cannot: {r.cannot}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add staff">
        {created ? (
          <div className="grid gap-3 text-[13px]">
            <p>Share this authenticator setup link with them over a secure channel. It&apos;s shown once.</p>
            <code className="break-all rounded-lg bg-sunken p-3 text-[12px]">{created.totp_uri}</code>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <Field label="Name"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Work email"><input className={inputCls} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Role">
              <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {Object.entries(staff.data?.roles ?? {}).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <ErrorBox error={add.error} />
            <Button variant="primary" busy={add.isPending} onClick={async () => setCreated(await add.mutateAsync(form))}>Create</Button>
          </div>
        )}
      </Modal>
    </Shell>
  );
}
