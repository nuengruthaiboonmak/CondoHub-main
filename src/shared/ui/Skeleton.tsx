import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type SkeletonVariant = "block" | "text" | "table-row";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SkeletonVariant;
  lines?: number;
}

const SKELETON_BASE = "motion-reduce:animate-none animate-pulse rounded-lg bg-skeleton";

export function Skeleton({ variant = "block", lines: linesProp, className, ...rest }: SkeletonProps) {
  const lines = linesProp ?? (variant === "table-row" ? 5 : 3);
  if (variant === "text") {
    return (
      <div role="status" aria-label="Loading" className={cx("flex flex-col gap-2", className)} {...rest}>
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={cx(SKELETON_BASE, index === lines - 1 ? "h-4 w-2/3" : "h-4 w-full")}
          />
        ))}
      </div>
    );
  }

  if (variant === "table-row") {
    return (
      <div role="status" aria-label="Loading" className={cx("flex flex-col gap-2", className)} {...rest}>
        {Array.from({ length: lines }, (_, index) => (
          <span key={index} aria-hidden="true" className={cx(SKELETON_BASE, "h-11 w-full")} />
        ))}
      </div>
    );
  }

  return (
    <div role="status" aria-label="Loading" className={cx(SKELETON_BASE, "h-24 w-full", className)} {...rest} />
  );
}
