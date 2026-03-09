#!/bin/bash
# Help Desk Badge Generator — Start Server
# Usage: ./start.sh [--show-mode]

set -e
cd "$(dirname "$0")"

PID_FILE="data/server.pid"
PORT="${PORT:-3000}"

# Check if already running
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Server already running (PID $OLD_PID)"
    echo "Use ./stop.sh to stop it first."
    exit 1
  fi
  rm -f "$PID_FILE"
fi

# Check port
if lsof -i ":$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Port $PORT is already in use."
  echo "Kill the process or set a different PORT: PORT=3001 ./start.sh"
  exit 1
fi

# Ensure data dirs
mkdir -p data/photos data/badges

# Parse flags
SHOW_MODE=0
ADMIN_LOCAL_ONLY="${ADMIN_LOCAL_ONLY:-1}"  # Default ON — admin only from localhost
for arg in "$@"; do
  case "$arg" in
    --show-mode) SHOW_MODE=1 ;;
    --remote-admin) ADMIN_LOCAL_ONLY=0 ;;  # Allow admin from any IP (use with Cloudflare)
  esac
done

# Check for admin token
if [ -z "$ADMIN_TOKEN" ]; then
  echo "Warning: No ADMIN_TOKEN set. Admin panel will be disabled."
  echo "Set it with: ADMIN_TOKEN=your-secret ./start.sh"
fi

# Start server
export ADMIN_TOKEN
export ADMIN_LOCAL_ONLY
export SHOW_MODE
export PORT
LOG_FILE="data/server.log"

nohup bun run src/server.ts > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

echo "$SERVER_PID" > "$PID_FILE"
sleep 1

# Verify it started
if kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "Badge Generator started!"
  echo "  PID:  $SERVER_PID"
  echo "  Port: $PORT"
  echo "  URL:  http://localhost:$PORT"
  if [ -n "$ADMIN_TOKEN" ]; then
    echo "  Admin: http://localhost:$PORT/admin"
  fi
  if [ "$SHOW_MODE" = "1" ]; then
    echo "  Mode: SHOW MODE (relaxed rate limits)"
  fi
  if [ "$ADMIN_LOCAL_ONLY" = "1" ]; then
    echo "  Admin: localhost only (use --remote-admin to allow remote access)"
  fi
  echo "  Log:  $LOG_FILE"
else
  echo "Failed to start server. Check $LOG_FILE for details."
  rm -f "$PID_FILE"
  exit 1
fi
