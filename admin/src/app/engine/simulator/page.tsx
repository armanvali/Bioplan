"use client";

import { useState } from "react";
import { Shell } from "@/components/Shell";
import { SimulatorPanel } from "@/components/Simulator";
import { Card, Field, inputCls } from "@/components/ui";
import { useAdmin } from "@/lib/hooks";
import type { Release } from "@/lib/types";

export default function SimulatorPage() {
  const releases = useAdmin<{ releases: Release[] }>("/engine/releases");
  const [id, setId] = useState("");
  const candidates = releases.data?.releases.filter((r) => r.status !== "rolled_back") ?? [];
  const chosen = id || candidates[0]?.id || "";
  return (
    <Shell title="Simulator" scope="engine.simulate">
      <div className="grid gap-4">
        <Card>
          {candidates.length ? (
            <Field label="Compare this release with live">
              <select value={chosen} onChange={(e) => setId(e.target.value)} className={inputCls}>
                {candidates.map((r) => <option key={r.id} value={r.id}>{r.version} ({r.status})</option>)}
              </select>
            </Field>
          ) : (
            <p className="text-ink-2">Create a draft release first; the simulator runs personas through live and the draft side by side.</p>
          )}
        </Card>
        {chosen ? <SimulatorPanel key={chosen} releaseId={chosen} /> : null}
      </div>
    </Shell>
  );
}
