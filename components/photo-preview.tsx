"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
export function PhotoPreview({ file, photoId, code, filename }: { file?: File; photoId?: string; code: string; filename: string }) {
  const [url, setUrl] = useState(""); const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let inactive = false; let objectUrl = "";
    setUrl(""); setFailed(false);
    void (async () => {
      try {
        let blob: Blob;
        if (photoId) {
          const response = await fetch(`/api/photos/${encodeURIComponent(photoId)}/thumbnail`, { headers: code ? { "x-demo-access-code": code } : {}, cache: "no-store" });
          if (!response.ok) throw new Error("Thumbnail unavailable"); blob = await response.blob();
        } else if (file) blob = file;
        else return;
        if (inactive) return;
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
      } catch { if (!inactive) setFailed(true); }
    })();
    return () => { inactive = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file, photoId, code, retry]);
  return <div className="flex h-44 items-center justify-center overflow-hidden rounded-box bg-base-200">
    {failed ? <div className="p-4 text-sm"><p>Preview unavailable. The image must still pass server validation.</p><button type="button" className="btn btn-sm mt-2" onClick={() => setRetry((value) => value + 1)}>Retry thumbnail</button></div> : url
      ? <Image unoptimized src={url} width={320} height={240} alt={filename} className="h-full w-full object-contain" onError={() => setFailed(true)} />
      : <span className="loading loading-spinner loading-sm" aria-label="Loading thumbnail" />}
  </div>;
}
