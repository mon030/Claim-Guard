"use client";
import { useState } from "react";
import type { PhotoItem } from "../lib/client/use-claim-guard";
import { PhotoPreview } from "./photo-preview";
export function PhotoUploader({ photos, disabled, add, remove, code }: { photos: PhotoItem[]; disabled: boolean; add: (files: File[]) => Promise<void>; remove: (key: string) => void; code: string }) {
  const [dragging, setDragging] = useState(false);
  return <section aria-labelledby="upload-title" className="space-y-4">
    <div><h2 id="upload-title" className="card-title">2. Add claim photos</h2><p className="mt-1 text-sm text-base-content/70">Choose 2–6 photos. ZIPs are opened on this device; only one image is sent per request.</p></div>
    <div className={`card card-dash ${dragging ? "bg-base-200" : ""}`} onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!disabled) void add(Array.from(event.dataTransfer.files)); }}>
      <div className="card-body items-center text-center"><p className="font-medium">Drop images or a ZIP here</p><p className="text-sm text-base-content/70">JPG, PNG, WebP · max 50 archive entries / 30 MB expanded · no nested archives</p>
        <label className="fieldset w-full max-w-md"><span className="sr-only">Choose photos or ZIP</span><input disabled={disabled} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.zip" className="file-input w-full" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void add(files); }} /></label>
      </div>
    </div>
    {photos.length > 6 ? <div className="alert alert-warning" role="alert">{photos.length} images selected. Remove extras to choose your own 2–6 photos.</div> : null}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{photos.map((photo, index) => <article className="card card-border" key={photo.key}>
      <div className="card-body gap-3"><PhotoPreview file={photo.file} code={code} filename={photo.filename} />
        <h3 className="break-all text-sm font-semibold">{index + 1}. {photo.filename}</h3><div className="flex flex-wrap items-center gap-2"><span className={`badge ${photo.status === "error" ? "badge-error" : photo.status === "done" ? "badge-success" : ""}`}>{photo.status}</span>{photo.prepared?.resized ? <span className="badge">Resized before upload</span> : null}{["hashing", "looking up"].includes(photo.status) ? <span className="loading loading-spinner loading-xs" aria-hidden="true" /> : null}</div>
        {photo.error ? <p className="text-sm text-error">{photo.error}</p> : null}<button type="button" className="btn" disabled={disabled} onClick={() => remove(photo.key)} aria-label={`Remove ${photo.filename}`}>Remove</button>
      </div>
    </article>)}</div>
    <p className="text-xs text-base-content/70">Files up to 3 MB keep their original bytes. Larger files are resized to a maximum 1600px edge before hashing and upload.</p>
  </section>;
}
