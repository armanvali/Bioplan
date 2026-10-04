"""Alembic environment. Production schema changes go through migrations; `create_all` is
only for dev and tests. Run from backend/:  alembic upgrade head  |  alembic revision --autogenerate -m "..." """

from __future__ import annotations

from alembic import context
from sqlalchemy import engine_from_config, pool

import stacksense.models  # noqa: F401  (register every table)
from stacksense.config import get_settings
from stacksense.db import SCHEMAS, Base

config = context.config
config.set_main_option("sqlalchemy.url", get_settings().database_url.replace("%", "%%"))
target_metadata = Base.metadata


def include_name(name, type_, parent_names):  # type: ignore[no-untyped-def]
    # Only our schemas; ignore anything else living in the database.
    if type_ == "schema":
        return name in SCHEMAS
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"), target_metadata=target_metadata, literal_binds=True,
        include_schemas=True, include_name=include_name, compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata, include_schemas=True, include_name=include_name,
            compare_type=True, render_as_batch=connection.dialect.name == "sqlite",
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
