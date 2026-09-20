FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    L99_DB_PATH=/data/l99.db \
    L99_VIDEO_OUTPUT_DIR=/data/video-exports \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node . .

# Artifact promotion requires a real Playwright browser in the shipped runtime.
# Keep it out of the repository dependency graph while pinning the production
# carrier to the same Playwright release used by the test harness.
RUN npm install --omit=dev --no-save playwright@1.61.1 \
    && npx playwright install --with-deps chromium \
    && mkdir -p /data /data/video-exports \
    && chown -R node:node /data /app/node_modules /ms-playwright

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
