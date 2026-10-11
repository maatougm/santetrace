import type { IconProps } from "./contract";
import { cx } from "./cx";
import { DIRECTIONAL_ICONS, ICON_GLYPHS, type AnyIconName } from "./icons";
import styles from "./Icon.module.css";

export interface IconExtraProps extends Omit<IconProps, "name"> {
  name: AnyIconName;
  /**
   * Mirror under [dir="rtl"]. Defaults to true for direction-bearing icons
   * (arrows, chevrons left/right, log-out, send) and false for all others.
   */
  mirror?: boolean;
}

/** Inline SVG icon: 24 viewBox, 1.75 stroke, currentColor. Decorative unless `title` is set. */
export function Icon({ name, size = 18, title, className, mirror }: IconExtraProps) {
  const shouldMirror = mirror ?? DIRECTIONAL_ICONS.has(name);
  const labelled = Boolean(title);

  return (
    <svg
      className={cx(styles.icon, shouldMirror && styles.mirror, className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      aria-label={labelled ? title : undefined}
      focusable="false"
    >
      {labelled ? <title>{title}</title> : null}
      {ICON_GLYPHS[name]}
    </svg>
  );
}
