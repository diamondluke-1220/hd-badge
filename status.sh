#!/bin/bash
# Help Desk Badge Generator — Server Status

cd "$(dirname "$0")"

PID_FILE="data/server.pid"
DB_FILE="data/badges.db"

echo "═══ Help Desk Badge Generator ═══"
echo ""

# Server status
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Status:  RUNNING"
    echo "PID:     $PID"
    PORT=$(lsof -p "$PID" -iTCP -sTCP:LISTEN -P 2>/dev/null | awk 'NR>1{print $9}' | head -1)
    echo "Port:    ${PORT:-unknown}"
  else
    echo "Status:  STOPPED (stale PID file)"
    rm -f "$PID_FILE"
  fi
else
  echo "Status:  STOPPED"
fi

echo ""

# Badge stats
if [ -f "$DB_FILE" ] && command -v sqlite3 >/dev/null 2>&1; then
  TOTAL=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM badges;")
  VISIBLE=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM badges WHERE is_visible = 1;")
  BAND=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM badges WHERE is_band_member = 1;")
  FANS=$((VISIBLE - BAND))
  echo "Badges:  $TOTAL total ($VISIBLE visible, $BAND band, $FANS fans)"
else
  echo "Badges:  (sqlite3 not available or no DB)"
fi

# Photo count
PHOTO_DIR="data/photos"
if [ -d "$PHOTO_DIR" ]; then
  PHOTOS=$(ls -1 "$PHOTO_DIR" 2>/dev/null | wc -l | tr -d ' ')
  echo "Photos:  $PHOTOS"
fi

# Badge image count
BADGE_DIR="data/badges"
if [ -d "$BADGE_DIR" ]; then
  BADGE_IMGS=$(ls -1 "$BADGE_DIR" 2>/dev/null | wc -l | tr -d ' ')
  echo "Images:  $BADGE_IMGS"
fi

echo ""
