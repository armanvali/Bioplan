import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-20 text-center">
      <p className="eyebrow">404</p>
      <h1 className="display mt-2 text-3xl">We couldn&apos;t find that page</h1>
      <Link href="/" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-ink px-5 font-medium text-white">Go home</Link>
    </main>
  );
}
