FROM node:22-alpine AS builder

# build-base + cmake: nodejs-whisper compiles whisper.cpp lazily on first use
# (not at install time) — build-base/cmake/ffmpeg here support the warm-up
# RUN step below, which forces that compile (+ model download) at build time
# instead of on the first real request in production.
RUN apk add --no-cache git build-base cmake ffmpeg wget
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate && npm install -g rimraf

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
COPY scripts ./scripts
RUN pnpm install
RUN node scripts/warmup-whisper.cjs

COPY . .
RUN pnpm tsc

FROM node:22-alpine

# ffmpeg: local transcription fallback's audio preprocessing (see LocalTranscriptionService)
# python3/pip: local AUDIO_EXTRACTION fallback shells out to yt-dlp (see
# LocalAudioExtractionService), installed via pip rather than a prebuilt
# binary — yt-dlp's official standalone releases are glibc-linked and won't
# run on this musl/Alpine image. SEGMENTATION fallback (see
# LocalSegmentationService, backend/scripts/segment.py) needs numpy + scipy
# (both have prebuilt musllinux wheels, install instantly) + ruptures, which
# doesn't — its small Cython extension needs gcc/musl-dev/python3-dev to
# build from source (confirmed: a full ML stack here — fastembed/onnxruntime,
# then scikit-learn as a second attempt — has no Alpine wheels at all and
# was dropped in favor of hand-written TF-IDF; see segment.py).
# --break-system-packages: Alpine's Python refuses global pip installs by
# default (PEP 668); safe to override in an isolated, single-purpose
# container image.
RUN apk add --no-cache dumb-init wget curl unzip ffmpeg python3 py3-pip gcc musl-dev python3-dev
RUN pip install --break-system-packages --no-cache-dir yt-dlp numpy scipy ruptures
# Deno: JS runtime yt-dlp shells out to for solving YouTube's "n challenge"
# (see scripts/install-deno.cjs). Installed globally here since the Docker
# runtime stage has no $HOME-vs-build-time split like Render does — no need
# for the fixed-directory workaround that script uses there.
RUN curl -fsSL https://deno.land/install.sh | sh -s -- --no-modify-path \
  && ln -s /root/.deno/bin/deno /usr/local/bin/deno

WORKDIR /app

COPY package.json ./
COPY scripts ./scripts

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/whisper-models ./whisper-models

# Tailscale Setup

COPY --from=docker.io/tailscale/tailscale:stable /usr/local/bin/tailscaled /app/tailscaled
COPY --from=docker.io/tailscale/tailscale:stable /usr/local/bin/tailscale /app/tailscale
RUN mkdir -p /var/run/tailscale /var/cache/tailscale /var/lib/tailscale

# Cloud Run will automatically handles port binding (TODO: remove this after cloud run deployment)
# EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:${APP_PORT}/health || exit 1

CMD ["sh", "/app/scripts/start.sh"]
