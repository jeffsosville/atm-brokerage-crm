"use client";
// One brand switcher for the whole CRM. The choice is remembered in the browser, so picking
// "Cleaning" on the queue carries over to Companies, Pipeline, People and Due Diligence.
import { useEffect, useState } from "react";

export const VERTICALS = [
  { slug: "all", label: "All brands", short: "All", color: "#94a3b8" },
  { slug: "atm", label: "ATM Brokerage", short: "ATM", color: "#3b82f6", companyEnum: "ATM" },
  { slug: "vending", label: "VendingExits", short: "Vending", color: "#f59e0b", companyEnum: "Vending" },
  { slug: "cleaning", label: "CleaningExits", short: "Cleaning", color: "#10b981", companyEnum: "Cleaning" },
];
export const vMeta = (slug) => VERTICALS.find((v) => v.slug === slug) || VERTICALS[0];

const KEY = "crm_vertical";
const EVT = "crm-vertical-change";

// Brokers with an assigned vertical (profiles.assigned_vertical, e.g. "ATM") are locked to it.
export function lockedSlug(profile) {
  if (profile?.role === "broker" && profile?.assigned_vertical) return String(profile.assigned_vertical).toLowerCase();
  return null;
}

export function useVertical(profile) {
  const locked = lockedSlug(profile);
  const [slug, setSlug] = useState("all");
  useEffect(() => {
    try { const s = window.localStorage.getItem(KEY); if (s && VERTICALS.some((v) => v.slug === s)) setSlug(s); } catch {}
    const sync = () => { try { const s = window.localStorage.getItem(KEY); if (s) setSlug(s); } catch {} };
    window.addEventListener("storage", sync);
    window.addEventListener(EVT, sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener(EVT, sync); };
  }, []);
  const set = (s) => {
    setSlug(s);
    try { window.localStorage.setItem(KEY, s); window.dispatchEvent(new Event(EVT)); } catch {}
  };
  return [locked || slug, set, !!locked];
}

export function VerticalSelect({ value, onChange, locked }) {
  const m = vMeta(value);
  const style = {
    background: "#1a1f2e", color: m.color, border: "1px solid " + m.color + "66", padding: "7px 10px",
    borderRadius: 6, fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: locked ? "default" : "pointer",
  };
  if (locked) return <span style={style}>{m.label}</span>;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={style} title="Brand">
      {VERTICALS.map((v) => <option key={v.slug} value={v.slug}>{v.label}</option>)}
    </select>
  );
}

export function VerticalBadge({ slug }) {
  if (!slug) return null;
  const m = vMeta(slug);
  return <span style={{ color: m.color, border: "1px solid " + m.color + "55", borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 700 }}>{m.short}</span>;
}

// Deals: deal_type is null/'atm' for ATM, otherwise the vertical slug (kept in sync with vertical_id by trigger).
export const dealSlug = (d) => String(d?.deal_type || "atm").toLowerCase();
