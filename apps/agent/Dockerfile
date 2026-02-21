FROM node:22-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/agent/package.json apps/agent/

# Copy shared source (needed for workspace link)
COPY packages/shared/ packages/shared/

# Copy agent prisma files for generation
COPY apps/agent/prisma/ apps/agent/prisma/
COPY apps/agent/prisma.config.ts apps/agent/

RUN npm ci --ignore-scripts -w @world-tester/agent -w @world-tester/shared

# Install Playwright Chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN cd apps/agent && npx playwright install --with-deps chromium

# Generate Prisma client (dummy URL for codegen only)
RUN cd apps/agent && DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

# Copy agent source
COPY apps/agent/ apps/agent/

# Create data directories
RUN mkdir -p data/screenshots data/.browser-profile

COPY scripts/ws-vnc-proxy.mjs /app/scripts/ws-vnc-proxy.mjs
COPY apps/agent/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV DISPLAY=:99
ENV HEADLESS=true

ENTRYPOINT ["/entrypoint.sh"]
