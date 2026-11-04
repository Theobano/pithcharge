"use client";

import { createContext, useContext } from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BrandConfig {
  name: string;
  logoUrl: string | null;
  logoSmallUrl: string | null;
}

const BrandContext = createContext<BrandConfig>({ name: "Pithcharge", logoUrl: null, logoSmallUrl: null });

export function BrandProvider({ value, children }: { value: BrandConfig; children: React.ReactNode }) {
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  return useContext(BrandContext);
}

function DefaultMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground",
        className,
      )}
    >
      <Zap className="size-4" />
    </div>
  );
}

function Img({ src, alt, className }: { src: string; alt: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

function SmallMark({ className }: { className?: string }) {
  const { name, logoSmallUrl, logoUrl } = useBrand();
  const src = logoSmallUrl ?? logoUrl;
  return src ? (
    <Img src={src} alt={name} className={cn("size-8 shrink-0 rounded-md object-contain", className)} />
  ) : (
    <DefaultMark className={className} />
  );
}

/**
 * Expanded: the big logo alone (it already carries the name), otherwise the small mark plus the app name.
 * Inside a collapsible sidebar it collapses to the small mark only.
 */
export function BrandMark({ className }: { className?: string }) {
  const { name, logoUrl } = useBrand();
  return (
    <span className={cn("flex items-center gap-2 font-semibold", className)}>
      <span className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
        {logoUrl ? (
          <Img src={logoUrl} alt={name} className="h-8 max-w-48 object-contain" />
        ) : (
          <>
            <SmallMark />
            <span className="truncate">{name}</span>
          </>
        )}
      </span>
      <span className="hidden group-data-[collapsible=icon]:flex">
        <SmallMark />
      </span>
    </span>
  );
}
