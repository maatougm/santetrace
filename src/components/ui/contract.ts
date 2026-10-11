/**
 * Frozen interface contract for the shared Santetrace UI kit.
 *
 * Seeded by the frontend lead so patient and clinician screens can be built in
 * parallel with the design system. The design_system agent owns
 * src/components/ui/** and implements every component below with exactly these
 * props, exported from "@/components/ui". Props may gain optional fields;
 * existing fields must not be renamed or removed without telling the lead.
 */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/** Care status from the frozen API. "unknown" means missing data, never "fine". */
export type CareStatus = "green" | "orange" | "red" | "unknown";
/** Alert priority from the frozen API. Amber/red colours are reserved for these. */
export type Priority = "orange" | "red";

export type IconName =
  | "activity"
  | "alert-triangle"
  | "arrow-left"
  | "arrow-right"
  | "bell"
  | "calendar"
  | "check"
  | "check-circle"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "clipboard"
  | "clock"
  | "cloud-off"
  | "copy"
  | "download"
  | "droplet"
  | "edit"
  | "external-link"
  | "eye"
  | "file-text"
  | "heart-pulse"
  | "help-circle"
  | "home"
  | "inbox"
  | "info"
  | "languages"
  | "lock"
  | "link"
  | "log-out"
  | "message"
  | "minus"
  | "pill"
  | "plus"
  | "refresh"
  | "search"
  | "send"
  | "shield"
  | "sliders"
  | "stethoscope"
  | "upload"
  | "user"
  | "user-plus"
  | "users"
  | "wifi"
  | "wifi-off"
  | "x"
  | "x-circle";

export interface IconProps {
  name: IconName;
  /** Pixel size of the square SVG. Default 18. */
  size?: number;
  /** When set the icon is announced; otherwise it is aria-hidden. */
  title?: string;
  className?: string;
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button, sets aria-busy and shows a spinner. */
  loading?: boolean;
  iconStart?: IconName;
  iconEnd?: IconName;
  fullWidth?: boolean;
}

/** Same visual language as Button, rendered as a Next <Link>. */
export interface LinkButtonProps {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconStart?: IconName;
  iconEnd?: IconName;
  fullWidth?: boolean;
  className?: string;
  /** Opens in a new tab with rel="noopener noreferrer". */
  external?: boolean;
}

export interface CardProps {
  title?: ReactNode;
  /** Small uppercase label above the title. */
  eyebrow?: ReactNode;
  /** Secondary line under the title. */
  description?: ReactNode;
  /** Right-aligned header actions (inline-end in RTL). */
  actions?: ReactNode;
  children?: ReactNode;
  as?: "section" | "article" | "div";
  padding?: "none" | "sm" | "md" | "lg";
  /** "priority-orange" / "priority-red" add an edge accent for alert cards only. */
  tone?: "default" | "muted" | "priority-orange" | "priority-red";
  className?: string;
  id?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Optional back link rendered above the title. */
  back?: { href: string; label: string };
}

export interface StatusBadgeProps {
  status: CareStatus;
  /** Overrides the default French label (pass the Arabic label in RTL screens). */
  label?: string;
  size?: "sm" | "md" | "lg";
}

export interface PriorityBadgeProps {
  priority: Priority;
  label?: string;
  size?: "sm" | "md";
}

export type BadgeTone = "neutral" | "accent" | "muted" | "outline" | "orange" | "red";

export interface BadgeProps {
  tone?: BadgeTone;
  icon?: IconName;
  children: ReactNode;
  title?: string;
}

export type NoticeTone = "neutral" | "info" | "success" | "orange" | "red";

export interface NoticeProps {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
  /** Defaults to "status" (or "alert" for the red tone). */
  role?: "status" | "alert" | "note";
}

export interface FieldProps {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Fixed unit rendered inside the input end (e.g. "mmHg"). */
  suffix?: ReactNode;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  description?: ReactNode;
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Required accessible name for the radio group. */
  ariaLabel: string;
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
}

export interface SpinnerProps {
  /** Visually hidden label for screen readers. Default "Chargement". */
  label?: string;
  size?: number;
}

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  lines?: number;
  radius?: number;
}

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export interface ErrorStateProps {
  title?: ReactNode;
  message: ReactNode;
  /** Machine code from the API error envelope, shown discreetly. */
  code?: string;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  meta?: ReactNode;
  status?: CareStatus;
  icon?: IconName;
}

export interface TimestampProps {
  /** ISO-8601 string; null/undefined renders an em dash with "non renseigné". */
  iso: string | null | undefined;
  locale?: "fr" | "ar";
  /** "datetime" (default), "date", "time" or "relative". */
  format?: "datetime" | "date" | "time" | "relative";
  /** Prefix such as "Mesuré" rendered before the value. */
  label?: string;
}

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
}

export interface KeyValueListProps {
  items: KeyValueItem[];
  columns?: 1 | 2 | 3;
  dense?: boolean;
}

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  icon?: IconName;
  count?: number;
}

export interface TabsProps<T extends string> {
  tabs: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}

export interface TableColumn<Row> {
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
  align?: "start" | "end" | "center";
  width?: string;
  /** Numeric columns get tabular figures and end alignment. */
  numeric?: boolean;
}

export interface DataTableProps<Row> {
  columns: TableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  caption?: ReactNode;
  empty?: ReactNode;
  onRowClick?: (row: Row) => void;
  dense?: boolean;
}

export interface DemoLabelProps {
  /** Overrides the default "Démonstration fictive" text. */
  children?: ReactNode;
  tone?: "light" | "dark";
}
