/**
 * Santetrace UI kit — import everything from "@/components/ui".
 * Tokens (tokens.css) are imported once, globally, by the root layout.
 */
export type * from "./contract";

export { Icon } from "./Icon";
export type { IconExtraProps } from "./Icon";
export type { AnyIconName, ExtraIconName } from "./icons";
export { DIRECTIONAL_ICONS } from "./icons";

export { Button, buttonClassName } from "./Button";
export type { ButtonExtraProps } from "./Button";
export { LinkButton } from "./LinkButton";
export type { LinkButtonExtraProps } from "./LinkButton";

export { Card } from "./Card";
export type { CardExtraProps } from "./Card";
export { PageHeader } from "./PageHeader";
export type { PageHeaderExtraProps } from "./PageHeader";

export { StatusBadge } from "./StatusBadge";
export type { StatusBadgeExtraProps } from "./StatusBadge";
export { PriorityBadge } from "./PriorityBadge";
export type { PriorityBadgeExtraProps } from "./PriorityBadge";
export { Badge } from "./Badge";
export type { BadgeExtraProps } from "./Badge";
export {
  CARE_STATUS_META,
  CARE_STATUS_LABELS_AR,
  PRIORITY_META,
  PRIORITY_LABELS_AR,
} from "./status-meta";

export { Notice } from "./Notice";
export type { NoticeExtraProps } from "./Notice";

export { Field } from "./Field";
export type { FieldExtraProps } from "./Field";
export { describedBy, hintId, errorId } from "./field-ids";
export type { DescribedByOptions } from "./field-ids";
export { TextInput } from "./TextInput";
export type { TextInputExtraProps } from "./TextInput";
export { Select } from "./Select";
export type { SelectExtraProps } from "./Select";
export { TextArea } from "./TextArea";
export type { TextAreaExtraProps } from "./TextArea";
export { Checkbox } from "./Checkbox";
export type { CheckboxExtraProps } from "./Checkbox";
export { SegmentedControl } from "./SegmentedControl";
export type { SegmentedControlExtraProps } from "./SegmentedControl";

export { Spinner } from "./Spinner";
export { Skeleton } from "./Skeleton";
export { EmptyState } from "./EmptyState";
export type { EmptyStateExtraProps } from "./EmptyState";
export { ErrorState } from "./ErrorState";
export type { ErrorStateExtraProps } from "./ErrorState";

export { Dialog } from "./Dialog";
export type { DialogExtraProps } from "./Dialog";

export { Stat } from "./Stat";
export type { StatExtraProps } from "./Stat";
export { Timestamp } from "./Timestamp";
export type { TimestampExtraProps } from "./Timestamp";
export {
  formatTimestamp,
  DEFAULT_TIME_ZONE,
  INTL_LOCALE,
} from "./timestamp-format";
export type { TimestampFormat, TimestampLocale } from "./timestamp-format";
export { KeyValueList } from "./KeyValueList";
export type { KeyValueListExtraProps } from "./KeyValueList";

export { Tabs } from "./Tabs";
export type { TabsExtraProps } from "./Tabs";
export { tabPanelProps, tabPanelId, tabId } from "./tabs-ids";
export type { TabPanelAttributes } from "./tabs-ids";

export { DataTable } from "./DataTable";
export type { DataTableExtraProps, DataTableRowTone } from "./DataTable";

export { DemoLabel, DEMO_LABEL_FR, DEMO_LABEL_AR } from "./DemoLabel";
export { ConnectionBadge } from "./ConnectionBadge";
export type { ConnectionBadgeProps } from "./ConnectionBadge";
export { connectionBadgeView } from "./connection-badge";
export type { ConnectionBadgeView, ConnectionLanguage, ConnectionTone, LiveStatus } from "./connection-badge";
export type { DemoLabelExtraProps } from "./DemoLabel";

export { VisuallyHidden } from "./VisuallyHidden";
export type { VisuallyHiddenProps } from "./VisuallyHidden";
