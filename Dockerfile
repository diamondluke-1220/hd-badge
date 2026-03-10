# Help Desk Badge App — Docker Build
FROM oven/bun:1

WORKDIR /app

# Install production dependencies only
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile 2>/dev/null || bun install --production

# Copy application source
COPY src/ ./src/
COPY public/ ./public/

# Create data directory (mounted as volume in production)
RUN mkdir -p /app/data/photos /app/data/badges /app/data/thumbs

# Default environment
ENV PORT=3000
ENV ADMIN_LOCAL_ONLY=0
ENV TRUST_PROXY=1

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/server.ts"]
