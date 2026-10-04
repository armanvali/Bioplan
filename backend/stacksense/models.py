"""Import every module's tables so ``Base.metadata`` is complete (Alembic, create_all)."""

from stacksense.modules.admin.models import (  # noqa: F401
    AdminUser,
    AuditLog,
    JobRun,
    LLMCallLog,
    Outbox,
    Release,
)
from stacksense.modules.billing.models import (  # noqa: F401
    BillingPlan,
    CheckoutSession,
    Entitlement,
    Experiment,
    ExperimentAssignment,
    FunnelEvent,
    PaywallConfig,
    Price,
    PromoCode,
    Purchase,
    StripeEvent,
    Subscription,
)
from stacksense.modules.catalog.models import (  # noqa: F401
    CatalogSnapshotRow,
    Click,
    Conversion,
    LinkCheck,
    Product,
    ProductOverride,
    RetailerProgram,
)
from stacksense.modules.identity.models import MagicLink, PushSubscription, User  # noqa: F401
from stacksense.modules.profile.models import (  # noqa: F401
    Answer,
    CalendarFeed,
    Checkin,
    Consent,
    DoseEvent,
    DoseLog,
    IntakeSession,
    Lab,
    Plan,
    PlanItem,
    PlanItemProduct,
    PrivacyRequest,
    ProfileEvent,
    StaffAccess,
    Subject,
    UserFeatures,
)
