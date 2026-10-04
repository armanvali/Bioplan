"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { useApp } from "@/lib/store";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Don't hammer the API on 4xx: they won't fix themselves.
            retry: (n, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && n < 2,
          },
        },
      }),
  );
  const locale = useApp((s) => s.locale);

  useEffect(() => {
    document.documentElement.lang = locale === "fr-CA" ? "fr-CA" : "en";
  }, [locale]);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
