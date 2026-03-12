# Help Desk Badge App — Docker Build
FROM oven/bun:1

WORKDIR /app

# Install system dependencies for Playwright Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
    libwayland-client0 fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Install production dependencies
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile 2>/dev/null || bun install --production

# Install Playwright Chromium browser binary
RUN bunx playwright install chromium

# Copy application source
COPY src/ ./src/
COPY public/ ./public/

# Create data directory (mounted as volume in production)
RUN mkdir -p /app/data/photos /app/data/badges /app/data/thumbs

# Default environment
ENV PORT=3030
ENV ADMIN_LOCAL_ONLY=0
ENV TRUST_PROXY=1

EXPOSE 3030

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3030/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/server.ts"]
