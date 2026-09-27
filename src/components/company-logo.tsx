import Image from "next/image";
import type { Branding } from "@/types/ui";
import { product } from "@/config/product";

// A company's own logo or name when white-label branding is enabled.
export function BrandLogo({
  branding,
  width = 200,
}: {
  branding?: Branding | null;
  width?: number;
}) {
  if (branding?.logoUrl)
    return (
      <img
        src={branding.logoUrl}
        alt={branding.brandName ?? "Company logo"}
        style={{ width, maxHeight: width / 2, objectFit: "contain" }}
        className="h-auto max-w-full"
      />
    );
  if (branding?.brandName)
    return <span className="text-xl font-bold">{branding.brandName}</span>;
  return <CompanyLogo width={width} />;
}

export function CompanyLogo({ width = 200 }: { width?: number }) {
  return (
    <Image
      src={product.logo}
      alt={product.name}
      width={1536}
      height={1024}
      sizes="(max-width: 640px) 180px, 200px"
      style={{ width }}
      className="h-auto max-w-full rounded-lg"
    />
  );
}
