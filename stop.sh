#!/bin/bash
# Help Desk Badge Generator — Stop Server

cd "$(dirname "$0")"

PID_FILE="data/server.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "No PID file found. Server may not be running."
  exit 0
fi

PID=$(cat "$PID_FILE")

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  sleep 1
  if kill -0 "$PID" 2>/dev/null; then
    echo "Sending SIGKILL..."
    kill -9 "$PID" 2>/dev/null
  fi
  echo "Server stopped (PID $PID)."
else
  echo "Process $PID not running (stale PID file)."
fi

rm -f "$PID_FILE"
