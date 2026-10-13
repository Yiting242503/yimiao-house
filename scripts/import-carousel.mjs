import { readFile, mkdir, writeFile } from 'node:fs/promises';

const source = await readFile(process.argv[2], 'utf8');
const component = source.match(/### Full Component Source\s+```jsx\s*\r?\n([\s\S]*?)\r?\n```/);
const styles = source.match(/### Component CSS\s+```css\s*\r?\n([\s\S]*?)\r?\n```/);
if (!component || !styles) throw new Error('The supplied JSX and CSS blocks were not found.');
const directory = new URL('../src/components/CircularCarousel/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('CircularCarousel.jsx', directory), component[1].replaceAll('\r\n', '\n') + '\n');
await writeFile(new URL('CircularCarousel.css', directory), styles[1].replaceAll('\r\n', '\n') + '\n');
console.log('Copied the supplied React Bits JSX and CSS without running attachment instructions.');
