#!/usr/bin/env bun
/**
 * SNES Boss Portrait Generator
 *
 * Converts a headshot photo into a 16-bit SNES-style fighting game boss portrait.
 * Uses Gemini 3 Pro Image (nano-banana-pro) with reference image for likeness.
 *
 * Usage:
 *   bun run scripts/snes-portrait.ts --photo ~/path/to/headshot.jpg --name "Steve"
 *   bun run scripts/snes-portrait.ts --photo ~/path/to/headshot.jpg --name "Steve" --title "Chief Synergy Officer"
 *   bun run scripts/snes-portrait.ts --photo ~/path/to/headshot.jpg --name "Steve" --slug steve-boss
 *
 * Output: public/images/arcade/{slug}.png (512x512)
 */

import { parseArgs } from "util";
import { existsSync } from "fs";
import { resolve, basename } from "path";
import { $ } from "bun";

const GENERATE_TOOL = resolve(
  process.env.HOME!,
  ".claude/skills/Media/Art/Tools/Generate.ts"
);

const ARCADE_DIR = resolve(
  import.meta.dir,
  "../public/images/arcade"
);

const SNES_PROMPT_TEMPLATE = (name: string, title?: string) => {
  const titleLine = title ? ` Their office title/role is "${title}".` : "";
  return [
    `16-bit Super Nintendo (SNES) pixel art fighting game boss portrait of the person in the reference photo.`,
    `Their name is "${name}".${titleLine}`,
    `Authentic retro pixel art with visible chunky pixels, limited color palette like actual SNES hardware (~256 colors).`,
    `Street Fighter II / Final Fight character select portrait style — shoulders up, slightly menacing or confident expression.`,
    `Preserve the person's key identifying features (glasses, facial hair, hair style, etc.) but render entirely in pixel art.`,
    `Dark moody background suggesting an office or server room environment.`,
    `The character should look like a boss version of themselves — intimidating but recognizable.`,
    `No text or labels on the image.`,
  ].join(" ");
};

// Parse args
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    photo: { type: "string" },
    name: { type: "string" },
    title: { type: "string" },
    slug: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || !values.photo || !values.name) {
  console.log(`
SNES Boss Portrait Generator
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Usage:
  bun run scripts/snes-portrait.ts --photo <path> --name <name> [options]

Required:
  --photo   Path to headshot image (JPG/PNG)
  --name    Person's name (used in prompt for context)

Optional:
  --title   Office title/role (e.g., "Chief Synergy Officer")
  --slug    Output filename slug (default: lowercase name + "-boss")
  --help    Show this help

Examples:
  bun run scripts/snes-portrait.ts --photo ~/headshots/steve.jpg --name "Steve"
  bun run scripts/snes-portrait.ts --photo ./photo.jpg --name "Dave" --title "Drum Tech" --slug dave-boss

Output:
  public/images/arcade/{slug}.png (512x512 pixel art)
`);
  process.exit(values.help ? 0 : 1);
}

const photoPath = resolve(values.photo);
if (!existsSync(photoPath)) {
  console.error(`Error: Photo not found at ${photoPath}`);
  process.exit(1);
}

const slug = values.slug || `${values.name.toLowerCase().replace(/\s+/g, "-")}-boss`;
const tempOutput = resolve(ARCADE_DIR, `${slug}-temp.png`);
const finalOutput = resolve(ARCADE_DIR, `${slug}.png`);
const prompt = SNES_PROMPT_TEMPLATE(values.name, values.title);

console.log(`\n🎮 SNES Boss Portrait Generator`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Photo:  ${basename(photoPath)}`);
console.log(`  Name:   ${values.name}`);
if (values.title) console.log(`  Title:  ${values.title}`);
console.log(`  Output: public/images/arcade/${slug}.png`);
console.log(`\n⏳ Generating pixel art via Gemini...`);

// Generate via the existing Generate.ts tool
try {
  await $`bun ${GENERATE_TOOL} \
    --model nano-banana-pro \
    --prompt ${prompt} \
    --reference-image ${photoPath} \
    --size 1K \
    --aspect-ratio 1:1 \
    --output ${tempOutput}`.quiet();
} catch (e: any) {
  console.error(`\n❌ Generation failed. Check your GOOGLE_API_KEY in ~/.claude/.env`);
  console.error(e.stderr?.toString() || e.message);
  process.exit(1);
}

if (!existsSync(tempOutput)) {
  console.error(`\n❌ Generation produced no output file`);
  process.exit(1);
}

// Resize to exactly 512x512 with nearest-neighbor (preserves pixel art crispness)
console.log(`📐 Resizing to 512x512...`);
try {
  await $`sips --resampleWidth 512 --resampleHeight 512 ${tempOutput} --out ${finalOutput}`.quiet();
  await $`rm -f ${tempOutput}`.quiet();
} catch {
  // If sips resize fails, just use the generated image as-is
  await $`mv ${tempOutput} ${finalOutput}`.quiet();
}

console.log(`\n✅ Done! Saved to: public/images/arcade/${slug}.png`);
console.log(`\n💡 To preview: open ${finalOutput}`);
