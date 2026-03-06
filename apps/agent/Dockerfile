FROM node:22 AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    ca-certificates \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root workspace files
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/agent/package.json apps/agent/

# Copy shared source (needed for workspace link)
COPY packages/shared/ packages/shared/

# Copy agent prisma files for generation
COPY apps/agent/prisma/ apps/agent/prisma/
COPY apps/agent/prisma.config.ts apps/agent/

# Set PLAYWRIGHT_BROWSERS_PATH before npm install so postinstall scripts use it
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

# Do a fresh install for the current ARM64 architecture (skip postinstall scripts)
# Don't use the x86_64 lockfile - generate a new one for this architecture
RUN npm install --ignore-scripts -w @world-tester/agent -w @world-tester/shared

# Install Playwright Chromium explicitly 
RUN cd apps/agent && npx playwright install chromium

# Install system dependencies for Playwright
RUN cd apps/agent && npx playwright install-deps chromium

# Generate Prisma client (required for runtime)
# Set DATABASE_URL for prisma generation (dummy URL is fine for schema introspection)
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
