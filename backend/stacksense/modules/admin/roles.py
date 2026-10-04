"""Admin roles and least-privilege scopes (section 15.1)."""

from __future__ import annotations

SCOPES = {
    "staff.manage": "Manage staff and roles",
    "settings.manage": "Global settings",
    "audit.read": "View the audit log",
    "audit.export": "Export the audit log",
    "users.read": "Look up accounts (health data masked)",
    "users.reveal": "Reveal health data with a logged reason",
    "users.consent_record": "Record a consent change requested by the user",
    "users.entitlements": "Grant or revoke entitlements",
    "users.refund": "Issue refunds",
    "users.suspend": "Suspend accounts",
    "users.magic_link": "Resend magic links, merge accounts",
    "privacy.queue": "Work the privacy request queue",
    "cohorts.read": "De-identified cohort counts",
    "engine.read": "View graph, knowledge and releases",
    "engine.draft": "Draft question nodes, evidence, rules, dose bands",
    "engine.approve": "Approve or reject drafts",
    "engine.publish": "Publish approved releases and roll back",
    "engine.simulate": "Run the simulator",
    "catalog.read": "View products and retailers",
    "catalog.write": "Edit products, retailers and affiliate tags",
    "catalog.overrides": "Pin, demote or ban products",
    "revenue.read": "View plans, paywall and experiments",
    "revenue.write": "Change prices, plans, gates, promos, experiments",
    "dashboards.read": "Dashboards on de-identified data",
}

ROLES: dict[str, dict[str, object]] = {
    "super_admin": {
        "label": "Super admin",
        "scopes": {"staff.manage", "settings.manage", "audit.read", "audit.export", "users.read", "engine.read", "engine.publish",
                   "engine.simulate", "catalog.read", "revenue.read", "dashboards.read", "cohorts.read"},
        "cannot": "Publish rules without a clinical approver",
    },
    "clinical_editor": {
        "label": "Clinical editor",
        "scopes": {"engine.read", "engine.draft", "engine.simulate"},
        "cannot": "Approve own changes",
    },
    "clinical_reviewer": {
        "label": "Clinical reviewer (pharmacist / RD)",
        "scopes": {"engine.read", "engine.approve", "engine.publish", "engine.simulate"},
        "cannot": "Change billing or affiliate settings",
    },
    "catalog_manager": {
        "label": "Catalog manager",
        "scopes": {"catalog.read", "catalog.write", "catalog.overrides"},
        "cannot": "Edit rules or see health data",
    },
    "revenue_manager": {
        "label": "Revenue manager",
        "scopes": {"revenue.read", "revenue.write", "dashboards.read"},
        "cannot": "See identifiable health data",
    },
    "support_agent": {
        "label": "Support agent",
        "scopes": {"users.read", "users.reveal", "users.consent_record", "users.entitlements", "users.refund", "users.suspend",
                   "users.magic_link", "privacy.queue"},
        "cannot": "See unmasked health data without a logged reason",
    },
    "analyst": {
        "label": "Analyst",
        "scopes": {"dashboards.read", "cohorts.read"},
        "cannot": "Access individual records",
    },
}


def scopes_for(role: str) -> set[str]:
    return set(ROLES.get(role, {}).get("scopes", set()))  # type: ignore[arg-type]
