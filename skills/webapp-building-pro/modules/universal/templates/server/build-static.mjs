import { readdir, mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(), output = path.join(root, 'dist');
const excluded = new Set(['dist', 'node_modules', 'server', 'webapp-client']);
const allowed = new Set(['.html','.css','.js','.mjs','.json','.svg','.png','.jpg','.jpeg','.webp','.gif','.ico','.woff','.woff2','.ttf','.mp3','.mp4','.ogg','.wav','.csv','.txt','.pdf','.wasm']);
const privateFiles = new Set(['webapp-pro.json', 'package.json', 'package-lock.json', 'info.md']);
await rm(output, { recursive: true, force: true });
await mkdir(output);
async function copy(directory, relative = '') {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.') || privateFiles.has(item.name) || item.isSymbolicLink()) continue;
    const source = path.join(directory, item.name), rel = path.join(relative, item.name);
    if (item.isDirectory()) {
      if (!excluded.has(item.name)) await copy(source, rel);
    } else if (allowed.has(path.extname(item.name).toLowerCase())) {
      await mkdir(path.dirname(path.join(output, rel)), { recursive: true });
      await copyFile(source, path.join(output, rel));
    }
  }
}
await copy(root);
console.log('Static website built into dist/');
