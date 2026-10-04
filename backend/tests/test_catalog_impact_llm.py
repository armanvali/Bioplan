"""Catalog scoring (7.2), affiliate router (7.3), impact model (5), LLM guardrails (10),
crypto and tokens (11)."""

import json
from datetime import UTC, datetime

import pytest
from cryptography.exceptions import InvalidTag

from stacksense.core import crypto, tokens, totp
from stacksense.core.errors import Unauthorized
from stacksense.core.pdf import PdfDoc
from stacksense.modules.affiliate.router import LinkRouter, storefront_for
from stacksense.modules.catalog import scoring
from stacksense.modules.catalog.service import load_seed_catalog, match_plan, prefs_from_facts
from stacksense.modules.impact import model as impact
from stacksense.modules.llm import guardrails
from stacksense.modules.llm.gateway import LLMGateway
from stacksense.modules.llm.providers import ProviderResult, ScriptedProvider
from stacksense.personas import run_persona

TAGS = {"amazon_ca_tag": "stacksense0c-20", "amazon_com_tag": "stacksense-20", "iherb_partner_code": "STACKSENSE"}


def test_dose_fit_penalises_5000_iu_for_a_2000_iu_plan():
    cat = load_seed_catalog()
    sr = next(p for p in cat.products if p["id"] == "sr-d3k2")
    ps = next(p for p in cat.products if p["id"] == "ps-d3k2")
    n, ratio = scoring.units_needed(sr, "vitamin_d3_k2", 2000, "IU")
    assert ratio == 2.5 and scoring.dose_fit(n, ratio, "softgel") == 0.0
    n, ratio = scoring.units_needed(ps, "vitamin_d3_k2", 2000, "IU")
    assert scoring.dose_fit(n, ratio, "capsule") == 1.0


def test_bayes_rating_shrinks_small_review_counts():
    small, _ = scoring.bayes_rating(4.9, 40, 4.6)
    big, _ = scoring.bayes_rating(4.6, 30000, 4.6)
    big_hi, _ = scoring.bayes_rating(4.7, 30000, 4.6)
    assert small < big_hi  # a 4.9 with 40 reviews doesn't beat a 4.7 with 30,000


def test_mayas_products(graph, kb, maya):
    plan = run_persona(maya, graph, kb).result
    facts = {"country": "CA", "diet": "vegetarian", "allergies": ["gelatin"], "powders_ok": True}
    out = match_plan(plan, load_seed_catalog(), prefs_from_facts(facts), TAGS)
    by = {i["ingredient_id"]: i for i in out["items"]}
    assert by["vitamin_d3_k2"]["best"]["product_id"] == "ps-d3k2"
    assert any("2.5×" in f["reason"] for f in by["vitamin_d3_k2"]["filtered"])
    assert by["magnesium_bisglycinate"]["best"]["form"] == "powder"
    assert any("Poorly absorbed" in f["reason"] for f in by["magnesium_bisglycinate"]["filtered"])  # oxide != bisglycinate
    assert by["curcumin_enhanced"]["swapped"]["product"]["id"] == "th-cur"  # out of stock -> next best promoted
    assert by["curcumin_enhanced"]["best"]["product_id"] == "now-cb"
    gummy = next(f for f in by["ashwagandha_ksm66"]["filtered"] if "gumm" in f["product"]["name"].lower())
    assert "Gelatin" in gummy["reason"]
    for item in out["items"]:
        offer = item["best"]["offer"]
        assert offer["retailer"] == "amazon_ca" and "tag=stacksense0c-20" in offer["url"]
        assert offer["price_as_of"] and offer["disclosure"]


def test_router_prefers_availability_then_price_then_commission():
    retailers = load_seed_catalog().retailers
    router = LinkRouter(retailers, TAGS)
    product = {"id": "x", "brand": "B", "name": "N", "updated_at": datetime.now(UTC).isoformat(), "offers": [
        {"retailer": "amazon_ca", "price": 10.0, "currency": "CAD", "in_stock": False, "query": "q"},
        {"retailer": "iherb", "price": 8.0, "currency": "USD", "in_stock": True, "query": "q"},
        {"retailer": "thorne", "price": 8.0, "currency": "USD", "in_stock": True, "sku": "s"},
    ]}
    offer = router.offer_for(product, "CA")
    # Same price: commission breaks the tie (Thorne 15% > iHerb 5%); the out-of-stock Amazon offer loses.
    assert offer["retailer"] == "thorne"
    assert storefront_for("CA") == "CA" and storefront_for("US") == "US" and storefront_for("FR") == "GLOBAL"


def test_us_storefront_uses_amazon_com_tag():
    router = LinkRouter(load_seed_catalog().retailers, TAGS)
    p = load_seed_catalog().by_id["th-b12"]
    offer = router.offer_for(p, "US")
    assert "amazon.com" in offer["url"] and "tag=stacksense-20" in offer["url"]


def test_impact_formulas():
    assert impact.combined([5.0, 5.0]) == pytest.approx(7.5)  # saturates: 10 * (1 - 0.5 * 0.5)
    assert impact.combined([10.0, 3.0]) == 10.0
    claim = type("S", (), {"min": 1000, "max": 4000, "unit": "IU"})
    assert impact.dose_fit(2000, "IU", claim) == 1.0
    assert impact.dose_fit(750, "IU", claim) == pytest.approx(0.5)
    assert impact.dose_fit(400, "IU", claim) == 0.0


def test_impact_map_is_reproducible_and_bounded(graph, kb, maya):
    r1 = run_persona(maya, graph, kb).result
    r2 = run_persona(maya, graph, kb).result
    assert r1["impact"] == r2["impact"]
    for a in r1["impact"]["areas"]:
        assert 0 <= a["projected"] <= 10 and 0 <= a["need"] <= 10
        if a["coverage"] is not None:
            assert 0 <= a["coverage"] <= 1
        assert sum(c["share"] for c in a["contributors"]) == pytest.approx(a["projected"], abs=0.1)


# ---------------------------------------------------------------- LLM guardrails


def test_claims_filter_and_faithfulness(kb):
    assert guardrails.claim_violations("Magnesium cures insomnia and treats anxiety") == ["cures", "treats"]
    assert guardrails.claim_violations("May support calmer sleep onset") == []
    vocab = guardrails.ingredient_vocabulary(kb)
    plan = {"items": [{"name": "Magnesium bisglycinate", "dose": "200 mg elemental"}]}
    assert guardrails.faithfulness_problems(["Take 200 mg of magnesium before bed."], plan, vocab, {"magnesium_bisglycinate"}) == []
    probs = guardrails.faithfulness_problems(["Take 400 mg of magnesium with iron."], plan, vocab, {"magnesium_bisglycinate"})
    assert "number 400 not in plan" in probs and any("iron" in p for p in probs)


def _plan(graph, kb, maya):
    return run_persona(maya, graph, kb).result


def test_explanations_fall_back_without_provider(graph, kb, maya):
    out = LLMGateway(kb).explain_plan(_plan(graph, kb, maya), {})
    assert out["source"] == "template"
    assert all(v["why_you"] for v in out["items"].values())
    assert out["disclaimer"].startswith("StackSense gives general information")


def test_unfaithful_llm_output_is_rejected(graph, kb, maya):
    plan = _plan(graph, kb, maya)
    bad = {"items": [{"item_id": "magnesium_bisglycinate", "why_you": "It cures your insomnia.", "what_it_does": "Take 800 mg nightly.", "evidence_summary": "Proven."}]}
    gw = LLMGateway(kb, ScriptedProvider(responses=[json.dumps(bad)]))
    out = gw.explain_plan(plan, {})
    assert out["items"]["magnesium_bisglycinate"]["source"] == "template"
    assert gw.logs[-1].outcome.startswith("partial")


def test_good_llm_output_is_used(graph, kb, maya):
    plan = _plan(graph, kb, maya)
    good = {"items": [{"item_id": "magnesium_bisglycinate", "why_you": "You said falling asleep is the hardest part.", "what_it_does": "It helps your muscles relax before bed.", "evidence_summary": "Small trials show calmer sleep onset."}]}
    gw = LLMGateway(kb, ScriptedProvider(responses=[json.dumps(good)]))
    out = gw.explain_plan(plan, {})
    assert out["items"]["magnesium_bisglycinate"]["source"] == "llm"


def test_invalid_json_retries_once_then_falls_back(kb):
    sp = ScriptedProvider(responses=["not json", "{\"mappings\": [{\"signal_id\": \"fatigue\", \"confidence\": 0.9, \"quote\": \"tired\"}]}"])
    gw = LLMGateway(kb, sp)
    out = gw.map_free_text("always tired", ["fatigue"])
    assert out["source"] == "llm" and len(sp.calls) == 2
    sp2 = ScriptedProvider(responses=["nope", "still nope"])
    out2 = LLMGateway(kb, sp2).map_free_text("always tired", ["fatigue"])
    assert out2["source"] == "lexicon" and out2["mappings"][0]["needs_confirmation"]


def test_refusal_and_invented_ids_are_handled(kb):
    class Refuser:
        name = "r"

        def complete_json(self, **kw):
            return ProviderResult(text=None, refused=True, model=kw["model"])

    assert LLMGateway(kb, Refuser()).rephrase({"prompt": "Do you eat meat?", "helper": ""})["source"] == "approved"
    sp = ScriptedProvider(responses=['{"mappings": [{"signal_id": "cancer_risk", "confidence": 0.99, "quote": "x"}]}'])
    assert LLMGateway(kb, sp).map_free_text("x", ["fatigue"])["mappings"] == []


def test_follow_up_only_from_whitelisted_templates(kb):
    tpl = [{"id": "how_long", "text": "How long has {symptom} been going on?", "slots": {"symptom": ["restless legs"]}, "answer": {}}]
    ok = ScriptedProvider(responses=['{"template_id": "how_long", "slots": [{"name": "symptom", "value": "restless legs"}]}'])
    assert LLMGateway(kb, ok).follow_up(tpl, "legs")["text"] == "How long has restless legs been going on?"
    bad = ScriptedProvider(responses=['{"template_id": "how_long", "slots": [{"name": "symptom", "value": "chest pain"}]}'])
    assert LLMGateway(kb, bad).follow_up(tpl, "legs") is None


def test_cost_cap_forces_fallback(kb):
    gw = LLMGateway(kb, ScriptedProvider(responses=['{"prompt": "x", "helper": ""}']), monthly_budget_usd=0)
    assert gw.rephrase({"prompt": "Do you eat meat?", "helper": ""})["source"] == "approved"


# ---------------------------------------------------------------- crypto, tokens, pdf


def test_envelope_encryption_and_crypto_shredding():
    kp = crypto.LocalKeyProvider("ZGV2LW1hc3Rlci1rZXktMzItYnl0ZXMtbG9uZyEhISE=")
    dek = crypto.new_dek()
    wrapped = kp.wrap(dek)
    assert kp.unwrap(wrapped) == dek
    ct = crypto.encrypt_json(dek, {"ferritin": 22}, aad="lab")
    assert crypto.decrypt_json(dek, ct, aad="lab") == {"ferritin": 22}
    with pytest.raises(InvalidTag):
        crypto.decrypt_json(crypto.new_dek(), ct, aad="lab")  # without the original key: unreadable
    with pytest.raises(InvalidTag):
        crypto.decrypt_json(dek, ct, aad="other")  # bound to its context


def test_tokens_are_purpose_bound_and_expire():
    t = tokens.sign("s", "plan", {"pid": "p1"}, 60)
    assert tokens.verify("s", "plan", t)["pid"] == "p1"
    with pytest.raises(Unauthorized):
        tokens.verify("s", "access", t)
    with pytest.raises(Unauthorized):
        tokens.verify("other", "plan", t)
    with pytest.raises(Unauthorized):
        tokens.verify("s", "plan", tokens.sign("s", "plan", {}, -1))


def test_totp():
    secret = totp.new_secret()
    assert totp.verify(secret, totp.code_at(secret))
    assert not totp.verify(secret, "000000") or totp.code_at(secret) == "000000"


def test_pdf_writer():
    doc = PdfDoc("Test – note")
    doc.heading("Hello")
    doc.paragraph("Ferritin 18 µg/L — low. " * 40)
    doc.bullets(["one", "two"])
    pdf = doc.render()
    assert pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF") and b"/Type /Page" in pdf
