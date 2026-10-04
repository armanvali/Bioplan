"""Rate limits and bot protection for intake and click endpoints (section 11).

Fixed-window counters in Redis when ``STACKSENSE_REDIS_URL`` is set, otherwise
in-process (fine for one API instance and for tests).
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict

from stacksense.core.errors import DomainError


class RateLimited(DomainError):
    status_code = 429


class RateLimiter:
    def __init__(self, redis_url: str | None = None) -> None:
        self._redis = None
        if redis_url:
            try:
                import redis

                self._redis = redis.Redis.from_url(redis_url)
            except Exception:  # noqa: BLE001 - fall back to memory if Redis is unreachable
                self._redis = None
        self._lock = threading.Lock()
        self._counts: dict[str, int] = defaultdict(int)

    def hit(self, key: str, limit: int, window_s: int = 60) -> None:
        bucket = f"rl:{key}:{int(time.time() // window_s)}"
        if self._redis is not None:
            try:
                n = self._redis.incr(bucket)
                if n == 1:
                    self._redis.expire(bucket, window_s + 5)
            except Exception:  # noqa: BLE001
                n = self._mem(bucket)
        else:
            n = self._mem(bucket)
        if n > limit:
            raise RateLimited("rate_limited", "Too many requests. Please slow down.")

    def _mem(self, bucket: str) -> int:
        with self._lock:
            self._counts[bucket] += 1
            if len(self._counts) > 50_000:
                now = int(time.time() // 60)
                for k in [k for k in self._counts if int(k.rsplit(":", 1)[1]) < now - 2]:
                    del self._counts[k]
            return self._counts[bucket]

    def reset(self) -> None:
        with self._lock:
            self._counts.clear()
