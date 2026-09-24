import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = fileURLToPath(new URL("../app/icon.svg", import.meta.url));
const target = fileURLToPath(new URL("../app/favicon.ico", import.meta.url));
const svg = await readFile(source);
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((size) => sharp(svg).resize(size, size).png().toBuffer()));

// ICO supports embedded PNG images. Keep three sizes for browser tabs and shortcuts.
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (const [index, image] of images.entries()) {
  const entry = 6 + index * 16;
  directory.writeUInt8(sizes[index], entry);
  directory.writeUInt8(sizes[index], entry + 1);
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(image.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += image.length;
}
await writeFile(target, Buffer.concat([directory, ...images]));
console.log(`Generated ${target} (${sizes.join(", ")}px)`);
