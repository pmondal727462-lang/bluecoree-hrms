# syntax=docker/dockerfile:1
# One image runs the web app (default command) and the background worker
# (command: npm run worker). Migrations run as a separate one-off command.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
# Build-time values only; runtime secrets come from the environment.
ARG NEXT_PUBLIC_PRODUCT_NAME
ARG RAZORPAY_KEY_ID
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev --no-audit --no-fund \
  && npm install --no-save --no-audit --no-fund tsx prisma

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates postgresql-client tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system hrms && useradd --system --gid hrms --home /app hrms
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build --chown=hrms:hrms /app/package.json /app/package-lock.json ./
COPY --from=build --chown=hrms:hrms /app/node_modules ./node_modules
COPY --from=build --chown=hrms:hrms /app/.next ./.next
COPY --from=build --chown=hrms:hrms /app/public ./public
COPY --from=build --chown=hrms:hrms /app/prisma ./prisma
COPY --from=build --chown=hrms:hrms /app/src ./src
COPY --from=build --chown=hrms:hrms /app/scripts ./scripts
COPY --from=build --chown=hrms:hrms /app/next.config.ts /app/tsconfig.json ./
RUN mkdir -p /app/data/backups /app/data/uploads && chown -R hrms:hrms /app/data
USER hrms
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npx", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
