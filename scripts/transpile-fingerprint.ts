// Prints a hash of each source file's transpiled code, one line per file.
// Comments and formatting do not survive transpiling, so a comments-only
// change leaves every hash the same. Usage:
//   bun scripts/transpile-fingerprint.ts > before.txt
//   (edit)
//   bun scripts/transpile-fingerprint.ts | diff before.txt -

import { Glob } from 'bun';
import { createHash } from 'crypto';

const patterns = ['src/**/*.ts', 'public/js/**/*.js', 'scripts/**/*.ts'];
const tsTranspiler = new Bun.Transpiler({ loader: 'ts', minifyWhitespace: true });
const jsTranspiler = new Bun.Transpiler({ loader: 'js', minifyWhitespace: true });

const files: string[] = [];
for (const pattern of patterns) {
  for await (const path of new Glob(pattern).scan('.')) files.push(path);
}
files.sort();

for (const path of files) {
  const source = await Bun.file(path).text();
  const transpiler = path.endsWith('.ts') ? tsTranspiler : jsTranspiler;
  const code = transpiler.transformSync(source);
  console.log(`${createHash('sha256').update(code).digest('hex').slice(0, 16)}  ${path}`);
}
