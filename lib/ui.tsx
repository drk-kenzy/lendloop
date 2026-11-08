import {
  Hammer,
  Package,
  Sprout,
  SprayCan,
  Tent,
  CookingPot,
  Zap,
  type LucideIcon,
} from "lucide-react";

const CATEGORY_ICON: Record<string, LucideIcon> = {
  "power tools": Zap,
  "hand tools": Hammer,
  garden: Sprout,
  kitchen: CookingPot,
  camping: Tent,
  cleaning: SprayCan,
  other: Package,
};

/** Line icon for a tool category (no emoji, themed through currentColor). */
export function CategoryIcon({ category, size = 20 }: { category: string; size?: number }) {
  const Icon = CATEGORY_ICON[category] ?? Package;
  return <Icon size={size} strokeWidth={1.75} aria-hidden />;
}

/** 2030-01-05 -> "5 Jan 2030" (locale independent, UTC). */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
