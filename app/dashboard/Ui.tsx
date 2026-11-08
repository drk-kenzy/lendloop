"use client";

import { BadgeCheck, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function Empty({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="big" aria-hidden>
        <Icon size={30} strokeWidth={1.5} />
      </span>
      {children}
    </div>
  );
}

export function Skeletons({ count = 3 }: { count?: number }) {
  return (
    <ul className="grid" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="skeleton" />
      ))}
    </ul>
  );
}

export function SectionHead({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: ReactNode;
}) {
  return (
    <div className="section-head">
      <h2>
        {title}
        {count !== undefined && <span className="count">{count}</span>}
      </h2>
      {children}
    </div>
  );
}

export function TrustedBadge() {
  return (
    <span className="tag trusted plain">
      <BadgeCheck size={13} strokeWidth={2} aria-hidden /> Trusted Lender
    </span>
  );
}

export function statusLabel(status: string, overdue: boolean): string {
  return overdue ? "overdue" : status;
}
