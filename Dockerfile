FROM node:24-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
	&& apt-get install --yes --no-install-recommends ca-certificates ffmpeg gosu tini \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PORT=3000

RUN mkdir -p /app/.data && chown node:node /app/.data

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint

RUN chmod 755 /usr/local/bin/docker-entrypoint

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint"]
CMD ["node", "src/index.ts"]
