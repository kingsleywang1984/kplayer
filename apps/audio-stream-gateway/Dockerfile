FROM node:20-slim

# YouTube requires solving a signature / "n" challenge before it hands out media formats.
# yt-dlp does that through EJS, which needs a JavaScript runtime (Deno) plus the yt-dlp-ejs
# solver scripts. Without them extraction silently degrades to storyboard images only and
# every audio download fails. See https://github.com/yt-dlp/yt-dlp/wiki/EJS
RUN apt-get update \
  && apt-get install -y ffmpeg python3 python3-pip python3-venv curl unzip \
  && python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir yt-dlp yt-dlp-ejs bgutil-ytdlp-pot-provider \
  && ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp \
  && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/opt/deno sh -s -- -y \
  && ln -s /opt/deno/bin/deno /usr/local/bin/deno \
  && rm -rf /var/lib/apt/lists/*

# YouTube applies its bot check by source address, and a shared cloud egress fails it no
# matter what cookies are supplied. wgcf enrols a free Cloudflare WARP identity and
# wireproxy speaks WireGuard entirely in userspace, exposing it as a local SOCKS5 proxy -
# no TUN device and no NET_ADMIN, neither of which a Render container is granted.
ARG TARGETARCH
ARG WGCF_VERSION=2.2.32
ARG WIREPROXY_VERSION=1.1.3
RUN curl -fsSL -o /usr/local/bin/wgcf \
      "https://github.com/ViRb3/wgcf/releases/download/v${WGCF_VERSION}/wgcf_${WGCF_VERSION}_linux_${TARGETARCH}" \
  && chmod +x /usr/local/bin/wgcf \
  && curl -fsSL -o /tmp/wireproxy.tar.gz \
      "https://github.com/pufferffish/wireproxy/releases/download/v${WIREPROXY_VERSION}/wireproxy_linux_${TARGETARCH}.tar.gz" \
  && tar -xzf /tmp/wireproxy.tar.gz -C /usr/local/bin wireproxy \
  && chmod +x /usr/local/bin/wireproxy \
  && rm -f /tmp/wireproxy.tar.gz

# The proof-of-origin token server that the yt-dlp plugin above talks to. Its own README
# is explicit that a PO token does not guarantee getting past a 403 or a bot check, only
# that the traffic looks more ordinary - so this sits alongside the proxy, not instead of it.
ARG BGUTIL_VERSION=1.3.2
RUN apt-get update && apt-get install -y --no-install-recommends git \
  && git clone --depth 1 --single-branch --branch ${BGUTIL_VERSION} \
       https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil \
  && cd /opt/bgutil/server \
  && npm ci --no-audit --no-fund \
  && npx tsc \
  && rm -rf /opt/bgutil/.git /root/.npm \
  && apt-get purge -y git && apt-get autoremove -y \
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
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /app/${APP_DIR}/warp-manager.sh

WORKDIR /app/${APP_DIR}

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
