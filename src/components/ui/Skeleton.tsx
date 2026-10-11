import type { CSSProperties } from "react";
import type { SkeletonProps } from "./contract";
import styles from "./Skeleton.module.css";

const LAST_LINE_WIDTH = "62%";
const DEFAULT_LINE_HEIGHT = "0.75rem";

function toCss(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/**
 * Loading placeholder, hidden from assistive tech. Put aria-busy="true" (and a
 * Spinner or text) on the region that is loading.
 */
export function Skeleton({ width, height, lines, radius }: SkeletonProps) {
  const lineCount = lines !== undefined && lines > 1 ? Math.floor(lines) : 1;
  const borderRadius = toCss(radius ?? 6);

  if (lineCount === 1) {
    const style: CSSProperties = {
      width: toCss(width) ?? "100%",
      height: toCss(height) ?? DEFAULT_LINE_HEIGHT,
      borderRadius,
    };
    return <span className={styles.bar} style={style} aria-hidden="true" />;
  }

  const lineHeight = toCss(height) ?? DEFAULT_LINE_HEIGHT;
  return (
    <span className={styles.stack} style={{ width: toCss(width) ?? "100%" }} aria-hidden="true">
      {Array.from({ length: lineCount }, (_, index) => (
        <span
          key={index}
          className={styles.bar}
          style={{
            width: index === lineCount - 1 ? LAST_LINE_WIDTH : "100%",
            height: lineHeight,
            borderRadius,
          }}
        />
      ))}
    </span>
  );
}
