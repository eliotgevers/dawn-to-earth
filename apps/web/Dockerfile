FROM oven/bun:1.4.2 AS development
WORKDIR /workspace
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
RUN bun install --frozen-lockfile
COPY --chown=bun:bun apps/web apps/web
COPY wiki wiki
WORKDIR /workspace/apps/web
RUN chown bun:bun .
USER bun
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["bun", "--bun", "next", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

FROM development AS production
RUN bun run build
ENV NODE_ENV=production
CMD ["bun", "--bun", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
