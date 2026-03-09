# Adding New Songs to the Badge App

When Help Desk releases new music, follow these steps to add songs to the badge maker.

## Prerequisites

- **ffmpeg** installed (`brew install ffmpeg`)
- **Bun** runtime
- MP3 file(s) of the new song(s)

## Quick Start (Single Song)

```bash
cd ~/Documents/HelpDesk/badge-app
bun scripts/extract-waveform.ts "/path/to/Help Desk - New Song.mp3"
```

Output looks like:
```
  'NEW SONG':              { duration: '3:15', data: [0.5,0.6,...] },
```

Copy that line and paste it into the `WAVEFORMS` object in `public/js/badge-render.js` (around line 51). That's it — the song automatically appears in the badge maker's song picker.

## Batch (All Songs at Once)

Useful when regenerating all waveforms for a new release:

```bash
./scripts/extract-all-waveforms.sh ~/Documents/HelpDesk/
```

This outputs all waveform entries. You can replace the entire `WAVEFORMS` object contents with the output.

## How It Works

The waveform extraction script:

1. Uses `ffprobe` to get the track duration
2. Uses `ffmpeg` to decode the MP3 to raw 16-bit mono PCM at 22050 Hz
3. Splits the audio into 60 equal segments
4. Computes RMS (root mean square) amplitude for each segment
5. Normalizes values to 0.0-1.0 (loudest segment = 1.0)
6. Outputs a ready-to-paste JavaScript object entry

The 60-bar format matches what the badge renderer expects. Each bar becomes a vertical line in the waveform visualization on the badge.

## File Locations

| What | Where |
|------|-------|
| Waveform data | `public/js/badge-render.js` → `WAVEFORMS` object |
| Extraction script | `scripts/extract-waveform.ts` |
| Batch script | `scripts/extract-all-waveforms.sh` |
| MP3 source files | `~/Documents/HelpDesk/` (convention) |

## Checklist for a New Song

- [ ] Get the final master MP3
- [ ] Run `bun scripts/extract-waveform.ts "path/to/song.mp3"`
- [ ] Verify the song name and duration look correct in the output
- [ ] Paste the output line into `WAVEFORMS` in `public/js/badge-render.js`
- [ ] Open the badge app and verify the new song appears in the song picker
- [ ] Verify the waveform renders on a badge (try both barcode and sticker styles)

## Notes

- Song names are ALL CAPS in the app (the script auto-uppercases)
- The script strips "Help Desk - " prefix from filenames automatically
- If you need a different song name than what the filename suggests, just edit the quoted name in the output before pasting
- No database changes needed — songs are stored as plain text strings
- The `SONG_LIST` array is auto-generated from `Object.keys(WAVEFORMS)`, so adding to `WAVEFORMS` is the only step needed
