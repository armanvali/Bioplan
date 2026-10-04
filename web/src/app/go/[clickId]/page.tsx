"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { Loading } from "@/components/ui/primitives";
import { API_URL } from "@/lib/api";

/** Short links in emails and reminders: the API logs nothing new, it just redirects a known click. */
export default function GoPage() {
  const { clickId } = useParams<{ clickId: string }>();
  useEffect(() => {
    if (/^clk_[a-z0-9]+$/i.test(clickId)) window.location.replace(`${API_URL}/v1/go/${clickId}`);
  }, [clickId]);
  return (
    <main className="px-4 py-16">
      <Loading label="Taking you to the store…" />
      <p className="text-center text-xs text-ink-3">We may earn a commission from this purchase. It never changes what we recommend.</p>
    </main>
  );
}
