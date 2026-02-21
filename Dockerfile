FROM node:22-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

RUN npm ci --ignore-scripts

# Install Playwright Chromium + all its system deps in one shot
RUN npx playwright install --with-deps chromium

# Generate Prisma client (dummy URL — only needed for codegen, not connection)
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

# Copy the rest of the source
COPY . .

# Create data directories for volume mounts
RUN mkdir -p data/screenshots data/.browser-profile

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV DISPLAY=:99
ENV HEADLESS=true

ENTRYPOINT ["/entrypoint.sh"]
