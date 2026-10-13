import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
const [input='../generated-assets/yimiao-room-v1.png',output='public/assets/room.webp']=process.argv.slice(2);
await mkdir(dirname(output),{recursive:true});
await sharp(input).webp({quality:84,effort:6}).toFile(output);
console.log(`Room illustration optimized as WebP: ${output}`);
