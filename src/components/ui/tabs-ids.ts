/** Id of the tab button rendered by <Tabs idPrefix={prefix}>. */
export function tabId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

/** Id expected on the panel controlled by a tab (when Tabs gets `idPrefix`). */
export function tabPanelId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}

export interface TabPanelAttributes {
  id: string;
  role: "tabpanel";
  "aria-labelledby": string;
  tabIndex: 0;
}

/**
 * Spread on the element that shows the active tab's content:
 *   <div {...tabPanelProps("alerts", active)}>…</div>
 */
export function tabPanelProps(prefix: string, id: string): TabPanelAttributes {
  return { id: tabPanelId(prefix, id), role: "tabpanel", "aria-labelledby": tabId(prefix, id), tabIndex: 0 };
}
