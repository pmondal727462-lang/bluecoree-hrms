// Public build-time branding only. Never put secrets in NEXT_PUBLIC variables.
export const product = {
  name: process.env.NEXT_PUBLIC_PRODUCT_NAME?.trim() || "BlueCoreeHR",
  description: "Secure, connected human resource management for your company.",
  logo:
    process.env.NEXT_PUBLIC_PRODUCT_LOGO?.trim() ||
    "/bluecoree-logo-transparent.png",
};
