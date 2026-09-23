import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { listReferencePhotos, PHOTO_DIR } from "../lib/dataset";
import { thumbnail } from "../lib/photos";
import { runCli, writeReport } from "../lib/cli";

await runCli(async () => {
  const filenames = await listReferencePhotos();
  const require = createRequire(import.meta.url);
  const css = await readFile(require.resolve("daisyui/daisyui.css"), "utf8");
  const cards = await Promise.all(filenames.map(async (filename) => {
    const image = await thumbnail(await readFile(path.join(PHOTO_DIR, filename)));
    return `<article class="card card-border"><figure><img src="data:image/jpeg;base64,${image.toString("base64")}" alt="${filename}" width="480" height="360"></figure><div class="card-body"><h2 class="card-title">${filename}</h2></div></article>`;
  }));
  await writeReport("tmp/contact-sheet.html", `<!doctype html>
<html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>ClaimGuard photo contact sheet</title>
<style>${css}</style><style>body{font-family:system-ui,sans-serif;margin:0;padding:24px}main{max-width:1500px;margin:auto}h1{font-size:2rem;font-weight:700;margin-bottom:12px}.photo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin-top:24px}.card{break-inside:avoid}.card figure{height:260px}.card img{object-fit:contain;width:100%;height:100%}.card-body{padding:16px}@media print{body{padding:0}.photo-grid{grid-template-columns:repeat(3,1fr);gap:10px}.card figure{height:150px}.card-body{padding:8px}}</style></head>
<body><main><h1>ClaimGuard photo contact sheet</h1><p>36 reference photos. Review the images and filenames to complete your team's mapping.</p><section class="photo-grid" aria-label="Reference photos">${cards.join("\n")}</section></main></body></html>\n`);
  console.log("Wrote tmp/contact-sheet.html — open locally. All images and styles are embedded; no network requests or mapping hints.");
});
