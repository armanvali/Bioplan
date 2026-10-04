"use client";

import { useApp } from "./store";

// UI chrome strings. Question and plan text comes from the API (the graph is localised server-side).
const en = {
  "app.tagline": "A supplement plan built from your answers, checked for safety.",
  "nav.plan": "Plan",
  "nav.calendar": "Calendar",
  "nav.account": "Account",
  "nav.pricing": "Pricing",
  "nav.signin": "Sign in",
  "cta.start": "Start my intake",
  "cta.resume": "Resume my intake",
  "cta.continue": "Continue",
  "cta.back": "Back",
  "cta.skip": "Skip",
  "cta.unsure": "Not sure",
  "cta.showResults": "Show my results",
  "cta.buildPlan": "Build my plan",
  "cta.seePlan": "See my plan",
  "cta.unlock": "Unlock",
  "cta.save": "Save to my account",
  "intake.why": "Why we ask",
  "intake.heard": "What we're hearing",
  "intake.excluded": "Ruled out so far",
  "intake.confidence": "Confidence",
  "intake.questionOf": "Question {n} of about {total}",
  "intake.finishEarly": "You can see results now, or answer a few more for a sharper plan.",
  "review.title": "Here's what we heard",
  "review.sub": "Remove anything that's wrong. Your plan updates as you go.",
  "review.remove": "Not me",
  "review.restore": "Put back",
  "review.because": "Because you said",
  "plan.impact": "Health impact",
  "plan.stack": "Your stack",
  "plan.buy": "Buy list",
  "plan.safety": "Safety",
  "plan.excluded": "Left out on purpose",
  "plan.locked": "Waiting on a blood test",
  "plan.perMonth": "a month",
  "plan.disclaimer": "General information, not medical advice.",
  "calendar.today": "Today",
  "calendar.month": "Month",
  "calendar.export": "Add to my calendar",
  "paywall.trust": "Safety information is always free.",
  "account.consents": "Privacy choices",
  "account.billing": "Billing",
  "account.privacy": "Your data",
  "common.loading": "Loading…",
  "common.error": "Something went wrong.",
  "common.retry": "Try again",
  "common.offline": "You're offline. We'll keep your answers on this device.",
};

type Key = keyof typeof en;

const frCA: Partial<Record<Key, string>> = {
  "app.tagline": "Un plan de suppléments bâti à partir de vos réponses, vérifié pour la sécurité.",
  "nav.plan": "Plan",
  "nav.calendar": "Calendrier",
  "nav.account": "Compte",
  "nav.pricing": "Tarifs",
  "nav.signin": "Connexion",
  "cta.start": "Commencer",
  "cta.resume": "Reprendre",
  "cta.continue": "Continuer",
  "cta.back": "Retour",
  "cta.skip": "Passer",
  "cta.unsure": "Je ne sais pas",
  "cta.showResults": "Voir mes résultats",
  "cta.buildPlan": "Créer mon plan",
  "cta.seePlan": "Voir mon plan",
  "cta.unlock": "Débloquer",
  "cta.save": "Enregistrer dans mon compte",
  "intake.why": "Pourquoi cette question",
  "intake.heard": "Ce que nous comprenons",
  "intake.excluded": "Écartés jusqu'ici",
  "intake.confidence": "Confiance",
  "intake.questionOf": "Question {n} sur environ {total}",
  "review.title": "Voici ce que nous avons compris",
  "review.remove": "Pas moi",
  "review.restore": "Remettre",
  "review.because": "Parce que vous avez dit",
  "plan.impact": "Impact santé",
  "plan.stack": "Votre plan",
  "plan.buy": "Liste d'achats",
  "plan.safety": "Sécurité",
  "plan.excluded": "Écartés volontairement",
  "plan.locked": "En attente d'une prise de sang",
  "plan.perMonth": "par mois",
  "plan.disclaimer": "Information générale, pas un avis médical.",
  "calendar.today": "Aujourd'hui",
  "calendar.month": "Mois",
  "calendar.export": "Ajouter à mon calendrier",
  "paywall.trust": "Les informations de sécurité sont toujours gratuites.",
  "account.consents": "Choix de confidentialité",
  "account.billing": "Facturation",
  "account.privacy": "Vos données",
  "common.loading": "Chargement…",
  "common.error": "Un problème est survenu.",
  "common.retry": "Réessayer",
  "common.offline": "Vous êtes hors ligne. Vos réponses restent sur cet appareil.",
};

const dicts = { en, "fr-CA": frCA } as const;

export function translate(locale: "en" | "fr-CA", key: Key, vars: Record<string, string | number> = {}): string {
  const s = (dicts[locale] as Partial<Record<Key, string>>)[key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

export function useT() {
  const locale = useApp((s) => s.locale);
  return (key: Key, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

export type { Key as I18nKey };
