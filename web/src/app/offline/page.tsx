import Link from "next/link";

export const metadata = { title: "Offline" };

export default function Offline() {
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="display text-3xl">You&apos;re offline</h1>
      <p className="mt-3 text-ink-2">Your answers so far are safe on this device. Reconnect to continue your intake or load your plan.</p>
      <Link href="/" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-ink px-5 font-medium text-white">Try again</Link>
    </main>
  );
}
