"use client";
import { useCallback, useEffect, useState } from "react";
export type ToastKind = "success" | "warning" | "error" | "info";
export interface ToastMessage { id: string; message: string; kind: ToastKind; }
export function useToasts() {
  const [queue, setQueue] = useState<ToastMessage[]>([]);
  const notify = useCallback((message: string, kind: ToastKind = "info") => {
    setQueue((items) => items.some((item) => item.message === message) ? items : [...items, { id: crypto.randomUUID(), message, kind }]);
  }, []);
  const dismiss = useCallback((id: string) => setQueue((items) => items.filter((item) => item.id !== id)), []);
  useEffect(() => {
    const recovered = () => notify("Connection recovered. Your check can continue.", "success");
    window.addEventListener("claimguard:retry-recovered", recovered);
    return () => window.removeEventListener("claimguard:retry-recovered", recovered);
  }, [notify]);
  return { toasts: queue.slice(0, 3), notify, dismiss };
}
