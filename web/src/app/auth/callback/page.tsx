"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { ErrorNote, LinkButton, Loading } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useHydrated } from "@/lib/hooks";
import { useApp } from "@/lib/store";

function safeNext(next: string | null): string {
  // Only same-site paths: never bounce to another origin from a sign-in link.
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
}

function Callback() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const signIn = useApp((s) => s.signIn);
  const [error, setError] = useState<unknown>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!hydrated || done.current) return;
    done.current = true;
    const token = params.get("token");
    if (!token) {
      setError(new Error("This sign-in link is missing its token."));
      return;
    }
    api.auth
      .verify(token)
      .then((v) => {
        signIn(v.access_token, v.user);
        qc.invalidateQueries();
        router.replace(safeNext(v.next ?? params.get("next")));
      })
      .catch(setError);
  }, [hydrated, params, router, signIn, qc]);

  return error ? (
    <div className="mx-auto grid max-w-md gap-4">
      <ErrorNote error={error} />
      <LinkButton href="/account">Get a new link</LinkButton>
    </div>
  ) : (
    <Loading label="Signing you in…" />
  );
}

export default function CallbackPage() {
  return (
    <>
      <AppHeader minimal />
      <main id="main" className="px-4 py-10">
        <Suspense fallback={<Loading />}>
          <Callback />
        </Suspense>
      </main>
    </>
  );
}
