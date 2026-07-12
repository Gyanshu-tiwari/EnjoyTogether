# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ─── Stage 2: Production Runtime ──────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /usr/src/app
ENV NODE_ENV=production

# System deps: ffmpeg (transcoding), curl (healthcheck probe)
RUN apk add --no-cache ffmpeg curl

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled application from builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Create runtime directories (will be overlaid by volume mounts in prod)
RUN mkdir -p uploads output_hls \
  && chown -R node:node /usr/src/app

# Drop to non-root for security
USER node

EXPOSE 5000

# Health check — Docker restarts container on sustained failures
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

CMD ["node", "dist/server.js"]