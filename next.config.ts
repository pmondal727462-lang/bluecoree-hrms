import type { NextConfig } from "next";
// Private files (such as employee photos) shown inline load from short-lived
// signed S3 links, so the storage origin must be an allowed image source.
// Headers are fixed at build time: set STORAGE_* before building.
function storageOrigin() {
  const endpoint = process.env.STORAGE_ENDPOINT;
  if (!endpoint) return "";
  try {
    const url = new URL(endpoint);
    if (
      process.env.STORAGE_PATH_STYLE === "false" &&
      process.env.STORAGE_BUCKET
    )
      url.hostname = `${process.env.STORAGE_BUCKET}.${url.hostname}`;
    return ` ${url.origin}`;
  } catch {
    return "";
  }
}
// Razorpay Checkout (billing) loads its script and payment frame only when
// the payment provider is configured.
const razorpay = process.env.RAZORPAY_KEY_ID
  ? {
      script: " https://checkout.razorpay.com",
      connect: " https://api.razorpay.com https://lumberjack.razorpay.com",
      frame:
        "; frame-src https://api.razorpay.com https://checkout.razorpay.com",
    }
  : { script: "", connect: "", frame: "" };
const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(self)",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'" +
              (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "") +
              razorpay.script +
              "; style-src 'self' 'unsafe-inline'; img-src 'self' data:" +
              storageOrigin() +
              "; font-src 'self'; connect-src 'self'" +
              razorpay.connect +
              razorpay.frame +
              "; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
    ];
  },
};
export default config;
