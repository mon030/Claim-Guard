"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
export function PhotoPreview({ file, photoId, code, filename }: { file?: File; photoId?: string; code: string; filename: string }) {
  const [url, setUrl] = useState(""); const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = "";
    setUrl(""); setFailed(false);
    void (async () => {
      try {
        let blob: Blob;
        if (photoId) {
          const response = await fetch(`/api/photos/${encodeURIComponent(photoId)}/thumbnail`, { headers: code ? { "x-demo-access-code": code } : {}, signal: controller.signal, cache: "no-store" });
          if (!response.ok) throw new Error("Thumbnail unavailable"); blob = await response.blob();
        } else if (file) blob = file;
        else return;
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
      } catch { if (!controller.signal.aborted) setFailed(true); }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file, photoId, code]);
  return <div className="flex h-44 items-center justify-center overflow-hidden rounded-box bg-base-200">
    {failed ? <p className="p-4 text-sm">Preview unavailable. The image must still pass server validation.</p> : url
      ? <Image unoptimized src={url} width={320} height={240} alt={filename} className="h-full w-full object-contain" onError={() => setFailed(true)} />
      : <span className="loading loading-spinner loading-sm" aria-label="Loading thumbnail" />}
  </div>;
}
