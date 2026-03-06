FROM node:22 AS base

WORKDIR /app

# Install build dependencies needed for native modules
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy root workspace files
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

# Copy shared source (needed for workspace link)
COPY packages/shared/ packages/shared/

# Do a fresh install for the current ARM64 architecture
# Don't use the x86_64 lockfile - generate a new one for this architecture
RUN npm install -w @world-tester/web -w @world-tester/shared

# Copy web source
COPY apps/web/ apps/web/

# Build Next.js
RUN cd apps/web && npx next build

ARG WEB_PORT=3000
ENV PORT=${WEB_PORT}
EXPOSE ${WEB_PORT}

WORKDIR /app/apps/web

CMD ["npx", "next", "start"]
