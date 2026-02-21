FROM node:22-slim AS base

WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

# Copy shared source (needed for workspace link)
COPY packages/shared/ packages/shared/

RUN npm ci --ignore-scripts -w @world-tester/web -w @world-tester/shared

# Copy web source
COPY apps/web/ apps/web/

# Build Next.js
RUN cd apps/web && npx next build

ARG WEB_PORT=3000
ENV PORT=${WEB_PORT}
EXPOSE ${WEB_PORT}

WORKDIR /app/apps/web

CMD ["npx", "next", "start"]
