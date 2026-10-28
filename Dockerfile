# syntax=docker/dockerfile:1
FROM oven/bun:1.4.2-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/server/package.json packages/server/
COPY dev/mocks/package.json dev/mocks/
COPY scripts/package.json scripts/
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.2-slim
WORKDIR /app
ENV NODE_ENV=production \
    ASMODEUS_CONFIG=/config/asmodeus.yaml
COPY --from=deps /app ./
COPY packages/contracts/src packages/contracts/src
COPY packages/server/src packages/server/src
COPY packages/server/drizzle packages/server/drizzle
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
ENTRYPOINT ["bun", "run", "--cwd", "packages/server"]
CMD ["start"]
