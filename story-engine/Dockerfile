FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    L99_DB_PATH=/data/l99.db

COPY --chown=node:node . .

RUN mkdir -p /data && chown node:node /data

VOLUME ["/data"]
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
