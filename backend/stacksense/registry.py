"""Which knowledge release and question graph serve a given request.

Published releases live in ``admin.releases``; the seed content in ``stacksense/data``
is release zero. A release can be published to a percentage of *new* plans; a stable
hash of the subject id decides who gets it, so assignment is sticky. Existing plans
always keep the versions they were built with.
"""

from __future__ import annotations

import hashlib
import threading
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from stacksense.knowledge.base import KnowledgeBase, default_kb
from stacksense.knowledge.models import KnowledgeData
from stacksense.modules.intake.graph import Graph, GraphData, default_graph

_lock = threading.Lock()
_kb_cache: dict[str, KnowledgeBase] = {}
_graph_cache: dict[str, Graph] = {}


def _bucket(subject_id: str) -> int:
    return int(hashlib.sha256(subject_id.encode()).hexdigest()[:8], 16) % 100


def _published(db: Session, kind: str) -> list[Any]:
    from stacksense.modules.admin.models import Release

    rows = db.scalars(select(Release).where(Release.kind == kind, Release.status == "published").order_by(Release.published_at.desc())).all()
    return list(rows)


def kb_for_version(db: Session | None, version: str) -> KnowledgeBase:
    seed = default_kb()
    if version == seed.version:
        return seed
    with _lock:
        if version in _kb_cache:
            return _kb_cache[version]
    if db is None:
        raise KeyError(version)
    from stacksense.modules.admin.models import Release

    row = db.scalar(select(Release).where(Release.kind == "rules", Release.version == version))
    if row is None:
        raise KeyError(version)
    kb = KnowledgeBase(KnowledgeData(**row.data))
    with _lock:
        _kb_cache[version] = kb
    return kb


def graph_for_version(db: Session | None, version: str) -> Graph:
    seed = default_graph()
    if version == seed.version:
        return seed
    with _lock:
        if version in _graph_cache:
            return _graph_cache[version]
    if db is None:
        raise KeyError(version)
    from stacksense.modules.admin.models import Release

    row = db.scalar(select(Release).where(Release.kind == "graph", Release.version == version))
    if row is None:
        raise KeyError(version)
    g = Graph(GraphData(**row.data))
    with _lock:
        _graph_cache[version] = g
    return g


def live_kb(db: Session, subject_id: str | None = None) -> KnowledgeBase:
    """Newest published release whose rollout covers this subject; else the seed."""
    for row in _published(db, "rules"):
        if row.rollout_pct >= 100 or (subject_id and _bucket(subject_id) < row.rollout_pct):
            return kb_for_version(db, row.version)
    return default_kb()


def live_graph(db: Session, subject_id: str | None = None) -> Graph:
    for row in _published(db, "graph"):
        if row.rollout_pct >= 100 or (subject_id and _bucket(subject_id) < row.rollout_pct):
            return graph_for_version(db, row.version)
    return default_graph()


def clear_caches() -> None:
    with _lock:
        _kb_cache.clear()
        _graph_cache.clear()
