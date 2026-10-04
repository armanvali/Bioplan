# Web PWA or admin console (Next.js standalone output). Build with --build-arg APP=web|admin.
FROM node:22-slim AS build
ARG APP=web
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
WORKDIR /src
COPY ${APP}/package.json ${APP}/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ${APP}/ ./
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
WORKDIR /app
RUN useradd --create-home --uid 10001 app
COPY --from=build --chown=app /src/.next/standalone ./
COPY --from=build --chown=app /src/.next/static ./.next/static
COPY --from=build --chown=app /src/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
