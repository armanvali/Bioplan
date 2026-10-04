# StackSense API + worker image (same image, different command).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

RUN useradd --create-home --uid 10001 app

COPY backend/pyproject.toml backend/README.md ./
COPY backend/stacksense ./stacksense
RUN pip install ".[llm]"

COPY backend/alembic.ini ./
COPY backend/migrations ./migrations
COPY infra/docker/api-entrypoint.sh /usr/local/bin/api-entrypoint
RUN chmod +x /usr/local/bin/api-entrypoint

USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"
ENTRYPOINT ["api-entrypoint"]
CMD ["api"]
