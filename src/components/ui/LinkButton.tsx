import Link from "next/link";
import type { LinkButtonProps } from "./contract";
import { buttonClassName, ButtonContent } from "./Button";
import { VisuallyHidden } from "./VisuallyHidden";

export interface LinkButtonExtraProps extends LinkButtonProps {
  /** Accessible name override (e.g. icon-only links). */
  "aria-label"?: string;
  /** Marks the current page in navigation contexts. */
  "aria-current"?: "page" | "step" | "location" | true;
  /** Screen-reader suffix for external links. Default "(nouvel onglet)". */
  newTabLabel?: string;
  /** Forwarded to next/link. */
  prefetch?: boolean;
}

/** Same visual language as Button, rendered as a Next <Link> (or <a> when external). */
export function LinkButton({
  href,
  children,
  variant = "primary",
  size = "md",
  iconStart,
  iconEnd,
  fullWidth,
  className,
  external = false,
  newTabLabel = "(nouvel onglet)",
  prefetch,
  ...aria
}: LinkButtonExtraProps) {
  const classes = buttonClassName({ variant, size, fullWidth, className });

  if (external) {
    return (
      <a href={href} className={classes} target="_blank" rel="noopener noreferrer" {...aria}>
        <ButtonContent size={size} iconStart={iconStart} iconEnd={iconEnd ?? "external-link"}>
          {children}
        </ButtonContent>
        <VisuallyHidden>{newTabLabel}</VisuallyHidden>
      </a>
    );
  }

  return (
    <Link href={href} className={classes} prefetch={prefetch} {...aria}>
      <ButtonContent size={size} iconStart={iconStart} iconEnd={iconEnd}>
        {children}
      </ButtonContent>
    </Link>
  );
}
