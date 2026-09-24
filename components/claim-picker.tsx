"use client";
import { useState } from "react";
import { useCombobox } from "downshift";
import type { ClaimOption } from "../lib/api/claim-contracts";
const label = (claim: ClaimOption | null) => claim ? `${claim.claimId} · ${claim.claimant} · $${claim.amount.toLocaleString("en-US")}` : "";
export function ClaimPicker({ claims, selectedId, disabled, choose }: {
  claims: ClaimOption[]; selectedId: string; disabled: boolean; choose: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = claims.find((claim) => claim.claimId === selectedId) ?? null;
  const items = query === label(selected) ? claims : claims.filter((claim) =>
    `${claim.claimId} ${claim.claimant}`.toLowerCase().includes(query.toLowerCase()));
  const { isOpen, highlightedIndex, getInputProps, getLabelProps, getMenuProps, getItemProps, getToggleButtonProps } = useCombobox({
    id: "reference-claim", items, selectedItem: selected, inputValue: query, itemToString: label,
    isItemDisabled: (item) => Boolean(item.unavailableReason),
    onInputValueChange: ({ inputValue }) => setQuery(inputValue),
    onSelectedItemChange: ({ selectedItem }) => { if (selectedItem) choose(selectedItem.claimId); },
  });
  return <div className="fieldset relative min-w-0 w-full">
    <label {...getLabelProps()}>Reference claim</label>
    <div className="relative w-full"><input {...getInputProps({ disabled })} className="input w-full pr-12" placeholder="Search claim ID or claimant name" />
      <button {...getToggleButtonProps({ disabled, type: "button", "aria-label": "Show claims" })} className="btn btn-ghost btn-circle btn-sm absolute right-2 top-1/2 -translate-y-1/2">▾</button></div>
    <ul {...getMenuProps()} className={`menu menu-vertical absolute inset-x-0 top-full z-20 w-full min-w-0 rounded-box border border-base-300 bg-base-100 shadow-lg ${isOpen ? "max-h-72 overflow-y-auto overflow-x-hidden" : "hidden"}`}>
      {isOpen && items.map((item, index) => <li key={item.claimId} {...getItemProps({ item, index })} className="w-full min-w-0">
        <span className={`block w-full min-w-0 whitespace-normal break-words ${highlightedIndex === index ? "menu-active" : ""} ${item.unavailableReason ? "opacity-50" : ""}`}>
          {label(item)}{item.unavailableReason ? ` — ${item.unavailableReason}` : ""}
        </span></li>)}
    </ul>
    {isOpen && !items.length ? <p role="status">No matching claims.</p> : null}
  </div>;
}
