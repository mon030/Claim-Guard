"use client";
import { useEffect } from "react";
import type { ToastMessage } from "../lib/client/use-toasts";
const colors = { success: "alert-success", warning: "alert-warning", error: "alert-error", info: "alert-info" };
function Toast({ item, dismiss }: { item: ToastMessage; dismiss: (id: string) => void }) {
  useEffect(() => { const timer = setTimeout(() => dismiss(item.id), 4_500); return () => clearTimeout(timer); }, [item.id, dismiss]);
  return <div className={`alert ${colors[item.kind]} text-sm`} role="status"><span>{item.message}</span>
    <button type="button" className="btn btn-ghost btn-xs" aria-label={`Dismiss: ${item.message}`} onClick={() => dismiss(item.id)}>×</button></div>;
}
export function Toasts({ items, dismiss }: { items: ToastMessage[]; dismiss: (id: string) => void }) {
  // A separate layout row, not an overlay: action buttons always remain reachable.
  return <aside className="toast-dock" aria-label="Notifications"><div className="toast toast-end toast-bottom">
    {items.map((item) => <Toast key={item.id} item={item} dismiss={dismiss} />)}
  </div></aside>;
}
