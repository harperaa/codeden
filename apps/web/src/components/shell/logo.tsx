import { HARDEN_BRAND_RED, HARDEN_BRAND_WHITE, HARDEN_MARK } from "@codeden/contracts";
import { cn } from "@/lib/utils";

/**
 * The product's mark: a halved shield, red and white. Its shapes and colours come from the one
 * SVG source (`scripts/harden/brand/mark.svg`), like every icon; change it there.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox={HARDEN_MARK.viewBox} className={cn("shrink-0", className)} aria-hidden="true">
      {HARDEN_MARK.shapes.map((shape) => (
        <path
          key={shape.id}
          d={shape.d}
          fill={shape.fill === "ink" ? HARDEN_BRAND_RED : HARDEN_BRAND_WHITE}
          stroke={HARDEN_BRAND_RED}
          strokeWidth={shape.strokeWidth}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
