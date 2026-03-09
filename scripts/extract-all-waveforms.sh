#!/bin/bash
# extract-all-waveforms.sh — Generate waveform data for all MP3s in a directory
# Usage: ./scripts/extract-all-waveforms.sh [directory]
# Default: ~/Documents/HelpDesk/

DIR="${1:-$HOME/Documents/HelpDesk}"

echo "// Waveform data generated on $(date +%Y-%m-%d)"
echo "// Source directory: $DIR"
echo ""

for mp3 in "$DIR"/*.mp3; do
  [ -f "$mp3" ] || continue
  bun "$(dirname "$0")/extract-waveform.ts" "$mp3" 2>/dev/null | grep "^  '"
done
