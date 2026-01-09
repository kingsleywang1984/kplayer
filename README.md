# KPlayer Monorepo

A pnpm workspace that bundles the smart caching audio gateway and the Expo mobile app described in `kplayer.sdd.txt`. The gateway streams MP3 audio from YouTube while caching the bytes inside Cloudflare R2, and the Expo app consumes the `/stream/:videoId` endpoint for instant playback.

## Project structure

- `apps/audio-stream-gateway`: Express + FFmpeg service that proxies YouTube audio, pushes hot assets to R2, and exposes `/healthz` plus `/stream/:videoId`.
- `apps/mobile-audio-player`: Expo Router app that lets you paste a YouTube link, validates the video ID, calls the Render/Express API, and plays audio through `expo-av`.

## Prerequisites

- Node.js 20+
- pnpm 9+
- FFmpeg locally (only for local gateway dev; Docker image already installs it)
- Expo Go (for testing the mobile client)

## Bootstrap

```bash
pnpm install
```

This will install dependencies for both packages because the root workspace is already configured in `pnpm-workspace.yaml`.

## Backend: Audio Stream Gateway

1. Copy `apps/audio-stream-gateway/.env.example` to `.env` and fill in the Cloudflare R2 values (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET_NAME`, optional `PORT`). Provide `YOUTUBE_API_KEY` (YouTube Data API v3) if you want to enable server-side search, and set `ACCESS_CODE` if you want clients to see the new access gate overlay before using the app (leave blank to disable).
2. Make sure FFmpeg is available on your machine when running locally.
3. Start the server:

```bash
pnpm dev:gateway
```

### API

- `GET /healthz` → simple JSON `{ status: 'ok' }`.
- `GET /stream/:videoId` → streams `audio/mpeg`. When cache hits it reads straight from R2; cache misses trigger `ytdl-core` ➜ `ffmpeg` ➜ dual streaming (client + background upload).
- `GET /tracks` → 返回所有已缓存歌曲的元数据（标题、作者、缩略图、R2 对象键等）。
- `GET /search?q=<关键词>` → 调用 YouTube Data API 搜索音乐分类，返回前 5 条结果（标题、频道、缩略图、videoId）。
- `DELETE /tracks/:videoId` → 删除缓存音频、元数据，并从所有分组中移除该曲目。
- `GET /groups` / `POST /groups` / `PUT|DELETE /groups/:id` → 管理前端分组播放所需的歌单。

### Docker / Render

A Dockerfile lives at `apps/audio-stream-gateway/Dockerfile`. Build from the repo root:

```bash
docker build -f apps/audio-stream-gateway/Dockerfile .
```

Render can point at the same Dockerfile; the build copies the monorepo lockfile, installs only the `audio-stream-gateway` workspace, and exposes port 3000.

## Cloudflare R2 reminder

Follow the steps in the SDD (bucket, API token, endpoint). The environment variables consumed by the gateway are the same ones Render needs at deploy time.

## Mobile app: Expo audio client

1. Copy `apps/mobile-audio-player/.env.example` to `apps/mobile-audio-player/.env` and set `EXPO_PUBLIC_STREAM_BASE_URL` to your backend URL (for LAN testing it can be `http://<LOCAL_IP>:3000`). Set `EXPO_PUBLIC_ENABLE_AUTO_REFRESH=false` to disable the metadata refresh timer, `EXPO_PUBLIC_ENABLE_KEEP_ALIVE=false` to stop Render keep-alive pings, and optionally `EXPO_PUBLIC_ACCESS_CODE_TTL_MINUTES=<minutes>` to force users to re-enter the gateway access code after the given duration (leave unset for no expiry).
2. Start the Expo dev server:

```bash
pnpm dev:mobile
```

3. Scan the QR code with Expo Go or run `pnpm --filter mobile-audio-player run ios|android|web`（Web 版会自动监听 `http://localhost:3333`）。

The screen provides:

- Gateway health indicator (via Axios ping to `/healthz`).
- 单一输入框兼容 YouTube 链接/视频 ID 与任意关键词：URL 会立即播放，其他字符串自动调用 `/search`（点击输入框右侧的图标或直接按回车触发）。
- 未启用单曲/歌单循环时，播放器会按缓存列表顺序自动循环播放所有歌曲。
- Full playback controls (play/pause/stop, single-track looping, progress indicator) powered by `expo-av`.
- 可拖拽的进度条与实时时长显示，播放未完成也能展示缓存曲目时长。
- Cached track explorer（含播放、选择、自动刷新、删除等能力）可查看和维护 R2 中已有的曲目。
- 分组管理：在客户端选择多首歌曲，创建分组并一键循环播放任意歌单。
- Render 保活：app 会每 10 分钟 ping 一次 `/healthz`（可通过 `EXPO_PUBLIC_ENABLE_KEEP_ALIVE` 控制），避免免费实例在使用期间休眠。
- 用户设置页：可在客户端直接切换自动刷新与保活功能，而无需重新打包。
- YouTube 搜索：输入歌曲或歌词关键字，调用网关 `/search` 接口即刻播放搜索结果，无需手动粘贴链接。

## Next steps

- Follow `kplayer.sdd.txt` for Cloudflare and Render provisioning details.
- Extend with analytics, favorites, or authentication once baseline streaming is stable.
