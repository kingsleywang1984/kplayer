FROM node:20-slim

RUN apt-get update \
  && apt-get install -y ffmpeg python3 python3-pip python3-venv \
  && python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir yt-dlp \
  && ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

ARG APP_DIR=apps/audio-stream-gateway
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY ${APP_DIR}/package.json ./${APP_DIR}/package.json

RUN corepack enable \
  && pnpm install --filter audio-stream-gateway... --prod --no-optional

COPY ${APP_DIR} ${APP_DIR}

WORKDIR /app/${APP_DIR}

EXPOSE 3000

CMD ["node", "src/server.js"]
