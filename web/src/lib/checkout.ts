"use client";

// The checkout round-trip leaves the app (Stripe), so remember what we were buying for.
const KEY = "stacksense.checkout";

export interface PendingCheckout {
  checkoutId: string;
  planId?: string | null;
  email?: string | null;
  planKey: string;
}

export function savePending(p: PendingCheckout): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the success page falls back to asking for an email */
  }
}

export function loadPending(): PendingCheckout | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingCheckout) : null;
  } catch {
    return null;
  }
}

export function clearPending(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
