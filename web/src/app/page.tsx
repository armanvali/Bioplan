import Link from "next/link";
import { AppHeader, Footer } from "@/components/ui/AppHeader";
import { Icon } from "@/components/ui/Icon";
import { HomeCta } from "./home-cta";

const STEPS = [
  { icon: "list", title: "An intake that listens", text: "About 20 questions that change with every answer. Restless legs lead to iron; vegetarian rules out collagen. No 100-item quiz." },
  { icon: "shield", title: "Safety first, always free", text: "Medicines, conditions and pregnancy are checked against every ingredient. Anything risky is left out, and we tell you why." },
  { icon: "radar", title: "A plan you can see", text: "A health impact map across 8 areas, a buy list matched to certified products, and a daily calendar that ramps you in gently." },
];

export default function Home() {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto max-w-5xl px-4">
        <section className="grid items-center gap-10 py-12 sm:py-20 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="eyebrow">Supplements, sorted</p>
            <h1 className="display mt-3 text-4xl leading-[1.08] sm:text-6xl">A supplement plan built from your answers.</h1>
            <p className="mt-5 max-w-xl text-lg text-ink-2">
              Tell us how you sleep, eat, train and feel. A rules engine checked by pharmacists picks what&apos;s likely to help, leaves out what
              could hurt, and fits it to your budget and day.
            </p>
            <HomeCta />
            <p className="mt-4 flex items-center gap-2 text-sm text-ink-3">
              <Icon name="lock" size={16} /> No account needed. Nothing is saved unless you choose to.
            </p>
          </div>
          <div className="card relative overflow-hidden p-6" aria-hidden>
            <p className="eyebrow">Maya, 34 · sample plan</p>
            <ul className="mt-4 grid gap-3">
              {[
                ["Magnesium bisglycinate", "Wind-down · slow to fall asleep", "#5560C9"],
                ["Vitamin D3 + K2", "Breakfast · little sun Oct–Apr", "#3B7BD0"],
                ["Algae omega-3", "Dinner · vegetarian, sore after runs", "#D96B2B"],
                ["Vitamin B12", "Mon / Wed / Fri · vegetarian 6 years", "#3E4F8C"],
              ].map(([n, s, c]) => (
                <li key={n} className="flex items-center gap-3 rounded-[12px] bg-sunken p-3">
                  <span className="size-3 rounded-full" style={{ background: c }} />
                  <span>
                    <span className="block font-medium">{n}</span>
                    <span className="block text-sm text-ink-3">{s}</span>
                  </span>
                </li>
              ))}
              <li className="flex items-center gap-3 rounded-[12px] border border-dashed border-line-2 p-3 text-sm text-ink-2">
                <Icon name="lock" size={18} /> Iron: waiting on a ferritin test
              </li>
              <li className="flex items-center gap-3 rounded-[12px] bg-caution-tint p-3 text-sm text-caution-ink">
                <Icon name="shield" size={18} /> St John&apos;s wort left out: interacts with birth control
              </li>
            </ul>
          </div>
        </section>

        <section className="grid gap-4 pb-16 sm:grid-cols-3">
          {STEPS.map((s) => (
            <article key={s.title} className="card p-6">
              <Icon name={s.icon} className="text-sage" size={26} />
              <h2 className="display mt-3 text-xl">{s.title}</h2>
              <p className="mt-2 text-[15px] text-ink-2">{s.text}</p>
            </article>
          ))}
        </section>

        <section className="card mb-16 grid gap-6 p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
          <div>
            <h2 className="display text-2xl">Free to use. Pay for depth, never for safety.</h2>
            <p className="mt-2 text-[15px] text-ink-2">
              The intake, your stack and every safety note are free. The Full Report adds exact doses, the full impact map and a 90-day calendar.
              Plus adds reminders, check-ins and re-planning when your labs come back.
            </p>
          </div>
          <Link href="/pricing" className="inline-flex min-h-11 items-center justify-center rounded-full border border-line-2 bg-surface px-5 font-medium hover:bg-sunken">
            See pricing
          </Link>
        </section>
      </main>
      <Footer />
    </>
  );
}
