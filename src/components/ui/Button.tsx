import type { MouseEvent, ReactNode, Ref } from "react";
import type { ButtonProps, ButtonSize, ButtonVariant, IconName } from "./contract";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { SpinnerGlyph } from "./Spinner";
import styles from "./Button.module.css";

const ICON_SIZE: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

interface ButtonClassOptions {
  variant: ButtonVariant;
  size: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/** Shared by Button and LinkButton so both read as one control family. */
export function buttonClassName({ variant, size, fullWidth, className }: ButtonClassOptions): string {
  return cx(styles.button, styles[variant], styles[size], fullWidth && styles.fullWidth, className);
}

interface ButtonContentProps {
  size: ButtonSize;
  iconStart?: IconName;
  iconEnd?: IconName;
  loading?: boolean;
  children: ReactNode;
}

export function ButtonContent({ size, iconStart, iconEnd, loading, children }: ButtonContentProps) {
  const iconSize = ICON_SIZE[size];
  return (
    <>
      {loading ? (
        <SpinnerGlyph size={iconSize} />
      ) : iconStart ? (
        <Icon name={iconStart} size={iconSize} className={styles.icon} />
      ) : null}
      {children !== undefined && children !== null ? <span className={styles.label}>{children}</span> : null}
      {iconEnd && !loading ? <Icon name={iconEnd} size={iconSize} className={styles.icon} /> : null}
    </>
  );
}

export interface ButtonExtraProps extends ButtonProps {
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Action button. Defaults to type="button" — pass type="submit" inside forms.
 * `loading` makes the button inert (aria-disabled + aria-busy, clicks and
 * implicit form submission are blocked) but keeps it focusable, so keyboard and
 * screen-reader users do not lose their place; the start icon becomes a spinner.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  iconStart,
  iconEnd,
  fullWidth,
  className,
  disabled,
  type = "button",
  children,
  ref,
  onClick,
  ...rest
}: ButtonExtraProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={buttonClassName({ variant, size, fullWidth, className })}
      disabled={disabled}
      aria-disabled={loading || rest["aria-disabled"] || undefined}
      aria-busy={loading || undefined}
      // Only attach a handler when needed, so server-rendered buttons stay handler-free.
      onClick={onClick || (loading && type !== "button") ? handleClick : undefined}
    >
      <ButtonContent size={size} iconStart={iconStart} iconEnd={iconEnd} loading={loading}>
        {children}
      </ButtonContent>
    </button>
  );
}
