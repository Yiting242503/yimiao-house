import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const attachment = process.argv[2];
if (!attachment) throw new Error('Pass the user-provided React Bits source attachment path.');
const lines = (await readFile(attachment, 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/);
function fencedSource(heading, language) {
  let index = lines.findIndex(line => line.trim() === heading);
  if (index < 0) throw new Error(`Missing source section: ${heading}`);
  while (index + 1 < lines.length && !lines[index + 1].trim()) index++;
  if (lines[++index].trim() !== `\`\`\`${language}`) throw new Error(`Missing ${language} fence.`);
  const start = index + 1;
  while (++index < lines.length && lines[index].trim() !== '```') {}
  if (index === lines.length) throw new Error('Unclosed source fence.');
  return `${lines.slice(start, index).join('\n').trimEnd()}\n`;
}

const jsx = fencedSource('### Full Component Source', 'jsx');
const css = fencedSource('### Component CSS', 'css');
if (!jsx.includes('export default CrystalizedBall;') || !css.includes('.crystalized-ball')) throw new Error('Unexpected component source.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src/components/CrystalizedBall');
await mkdir(target, { recursive: true });
await writeFile(path.join(target, 'CrystalizedBall.jsx'), `// React Bits CrystalizedBall, copied from the user-provided full source.\n// Upstream: https://reactbits.dev/ (no license text was included in the attachment).\n${jsx}`, 'utf8');
await writeFile(path.join(target, 'CrystalizedBall.css'), css, 'utf8');
console.log('Extracted the provided CrystalizedBall component and CSS.');
