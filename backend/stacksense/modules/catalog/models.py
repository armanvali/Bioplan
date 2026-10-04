from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from stacksense.db import Base, JsonType, UTCDateTime, utcnow


class Product(Base):
    __tablename__ = "products"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[dict] = mapped_column(JsonType)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)
    updated_by: Mapped[str | None] = mapped_column(String(64))


class RetailerProgram(Base):
    __tablename__ = "retailer_programs"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    data: Mapped[dict] = mapped_column(JsonType)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)


class ProductOverride(Base):
    """Pin / demote / ban. Changes product order only, never which ingredient is recommended."""

    __tablename__ = "product_overrides"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(8))
    reason: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(String(64))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class CatalogSnapshotRow(Base):
    __tablename__ = "catalog_snapshots"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    data: Mapped[dict] = mapped_column(JsonType)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Click(Base):
    __tablename__ = "clicks"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    user_hash: Mapped[str] = mapped_column(String(64), index=True)
    plan_id: Mapped[str | None] = mapped_column(String(40), index=True)
    product_id: Mapped[str] = mapped_column(String(64), index=True)
    retailer: Mapped[str] = mapped_column(String(32))
    url: Mapped[str] = mapped_column(Text)
    ts: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)


class Conversion(Base):
    __tablename__ = "conversions"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    network: Mapped[str] = mapped_column(String(32))
    network_order_id: Mapped[str] = mapped_column(String(80), unique=True)
    click_id: Mapped[str | None] = mapped_column(String(40), index=True)
    retailer: Mapped[str] = mapped_column(String(32))
    product_id: Mapped[str | None] = mapped_column(String(64))
    amount: Mapped[float] = mapped_column(Float)
    commission: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(3))
    ts: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class LinkCheck(Base):
    __tablename__ = "link_checks"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(String(64), index=True)
    retailer: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16))  # ok | broken | out_of_stock | price_jump | missing_tag | stale_price
    detail: Mapped[str | None] = mapped_column(Text)
    checked_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)
