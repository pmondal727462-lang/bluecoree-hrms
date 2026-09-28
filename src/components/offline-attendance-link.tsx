"use client";
import Script from "next/script";
import { WifiOff } from "lucide-react";

// The same module prepares the cached clock and resumes pending sync in the
// employee workspace. It never caches authenticated pages or API responses.
export function OfflineAttendanceLink() {
  return (
    <>
      <Script src="/offline/app.js" type="module" strategy="afterInteractive" />
      <a
        href="/offline/index.html"
        className="inline-flex items-center gap-2 text-xs font-semibold text-blue-700"
        title="Prepare this device online, then clock in even without a connection"
      >
        <WifiOff size={16} /> Offline clock-in
      </a>
    </>
  );
}
