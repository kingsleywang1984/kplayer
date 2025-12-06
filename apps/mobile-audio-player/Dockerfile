FROM node:20-slim

ARG APP_DIR=apps/mobile-audio-player
WORKDIR /app

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY ${APP_DIR}/package.json ./${APP_DIR}/package.json

# Install dependencies
RUN corepack enable \
  && pnpm install --filter mobile-audio-player...

# Copy app source
COPY ${APP_DIR} ${APP_DIR}

WORKDIR /app/${APP_DIR}

EXPOSE 3333

# Start Expo web server
CMD ["pnpm", "web"]
