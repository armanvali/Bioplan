import pytest

from stacksense.core import expr


@pytest.mark.parametrize(
    "src,ctx,expected",
    [
        ("signals.fatigue >= 0.4 OR goals contains 'energy'", {"signals": {"fatigue": 0.2}, "goals": ["energy"]}, True),
        ("signals.fatigue >= 0.4 OR goals contains 'energy'", {"signals": {"fatigue": 0.2}, "goals": ["sleep"]}, False),
        ("facts.diet in ['vegetarian', 'vegan']", {"facts": {"diet": "vegan"}}, True),
        ("facts.diet not in ['vegetarian', 'vegan']", {"facts": {"diet": "meat"}}, True),
        ("len(answer.picks) >= 2", {"answer": {"picks": ["a", "b"]}}, True),
        ("any_of(answer.picks, ['during', 'after'])", {"answer": {"picks": ["after"]}}, True),
        ("NOT flags contains 'stop_sleep'", {"flags": []}, True),
        ("facts.age < 18", {"facts": {}}, False),  # missing -> null -> ordering is false
        ("labs.ferritin == null", {"labs": {}}, True),
        ("answer.minutes > derived.cutoff - 60", {"answer": {"minutes": 900}, "derived": {"cutoff": 920}}, True),
        ("(true AND false) || !false", {}, True),
        ("'abc' contains 'b'", {}, True),
    ],
)
def test_evaluate(src, ctx, expected):
    assert expr.truthy(src, ctx) is expected


@pytest.mark.parametrize("src", ["__import__('os')", "a.b(", "1 +", "foo(1)", "x ** 2", "a; b"])
def test_rejects_unsafe_or_bad_syntax(src):
    with pytest.raises(expr.ExprError):
        expr.compile_expr(src)


def test_never_evals_python():
    # Attribute access on non-dict objects is not possible: paths only resolve mappings.
    assert expr.evaluate("x.__class__", {"x": 1}) is None


def test_validate_reports_unknown_roots():
    assert expr.validate("facts.age > 3 AND bogus.x", {"facts"}) == ["unknown name 'bogus.x'"]
    assert expr.paths("signals.a >= 1 AND len(answers.B2.picks) > 0") == {("signals", "a"), ("answers", "B2", "picks")}
