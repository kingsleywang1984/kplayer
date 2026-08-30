FROM node:20-slim

# YouTube requires solving a signature / "n" challenge before it hands out media formats.
# yt-dlp does that through EJS, which needs a JavaScript runtime (Deno) plus the yt-dlp-ejs
# solver scripts. Without them extraction silently degrades to storyboard images only and
# every audio download fails. See https://github.com/yt-dlp/yt-dlp/wiki/EJS
RUN apt-get update \
  && apt-get install -y ffmpeg python3 python3-pip python3-venv curl unzip \
  && python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir yt-dlp yt-dlp-ejs \
  && ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp \
  && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/opt/deno sh -s -- -y \
  && ln -s /opt/deno/bin/deno /usr/local/bin/deno \
  && rm -rf /var/lib/apt/lists/*

ARG APP_DIR=apps/audio-stream-gateway
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY ${APP_DIR}/package.json ./${APP_DIR}/package.json

# Pinned to the version that produced pnpm-lock.yaml (lockfileVersion 9.0). Letting
# corepack pick the latest pulls pnpm 11, which needs a newer Node than this base image.
RUN corepack enable \
  && corepack prepare pnpm@9.12.0 --activate \
  && pnpm install --filter audio-stream-gateway... --prod --no-optional

COPY ${APP_DIR} ${APP_DIR}

COPY ${APP_DIR}/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /app/${APP_DIR}

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
