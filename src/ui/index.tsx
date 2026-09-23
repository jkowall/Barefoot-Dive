import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import { CaveIcon, PlanIcon, PlansIcon, SettingsIcon, TankIcon, ToolsIcon } from "./icons";

export { ProfileChart, type ProfileChartProps } from "./ProfileChart";
export type { ChartSegmentInput, ReserveCrossingInput } from "./profileChartModel";

export type RouteKey = "plan" | "cave" | "tools" | "tanks" | "plans";

export type NavigationItem = {
  readonly key: RouteKey;
  readonly label: string;
  readonly badge?: string | number;
};

const routeIcons: Record<RouteKey, () => ReactNode> = {
  plan: () => <PlanIcon />,
  cave: () => <CaveIcon />,
  tools: () => <ToolsIcon />,
  tanks: () => <TankIcon />,
  plans: () => <PlansIcon />,
};

const defaultNavigation: readonly NavigationItem[] = [
  { key: "plan", label: "Plan" },
  { key: "cave", label: "Cave" },
  { key: "tools", label: "Tools" },
  { key: "tanks", label: "Tank bank" },
  { key: "plans", label: "Saved plans" },
];

const projectLinks = [
  { label: "GitHub", href: "https://github.com/jkowall/Barefoot-Dive" },
  { label: "Changelog", href: "https://github.com/jkowall/Barefoot-Dive/blob/main/CHANGELOG.md" },
  { label: "Roadmap", href: "https://github.com/jkowall/Barefoot-Dive/blob/main/ROADMAP.md" },
  { label: "Validation notes", href: "https://github.com/jkowall/Barefoot-Dive/blob/main/documentation/reference-validation.md" },
  { label: "Apache 2.0 license", href: "https://github.com/jkowall/Barefoot-Dive/blob/main/LICENSE" },
  { label: "Report an issue", href: "https://github.com/jkowall/Barefoot-Dive/issues/new" },
] as const;

export function AppShell({ children, activeRoute, appVersion, engineVersion, navigation = defaultNavigation, onNavigate, onOpenSettings, title = "Barefoot Dive" }: {
  readonly children: ReactNode;
  readonly activeRoute: RouteKey;
  readonly appVersion: string;
  readonly engineVersion: string;
  readonly navigation?: readonly NavigationItem[];
  readonly onNavigate?: (route: RouteKey) => void;
  readonly onOpenSettings?: () => void;
  readonly title?: string;
}) {
  const navigationButtons = (location: "rail" | "bottom") => (
    <nav className={`bf-nav bf-nav--${location}`} aria-label="Primary navigation">
      {navigation.map((item) => <button aria-current={item.key === activeRoute ? "page" : undefined} className="bf-nav__item" data-active={item.key === activeRoute || undefined} key={item.key} onClick={() => onNavigate?.(item.key)} type="button">
        {routeIcons[item.key]()}<span>{item.label}</span>{item.badge !== undefined && <span className="bf-nav__badge">{item.badge}</span>}
      </button>)}
    </nav>
  );
  return <div className="bf-app-shell">
    <aside className="bf-rail">
      <div className="bf-brand"><img alt="" aria-hidden="true" className="bf-brand__mark" src="/logo-64.png" /><strong>{title}</strong></div>
      {navigationButtons("rail")}
      <div className="bf-rail__footer"><button aria-label="Open settings" className="bf-nav__item bf-nav__item--settings" onClick={onOpenSettings} type="button"><SettingsIcon /><span>Settings</span></button></div>
    </aside>
    <div className="bf-workspace">
      <header className="bf-topbar"><div className="bf-topbar__title">{title}</div><button aria-label="Open settings" className="bf-icon-button bf-topbar__settings" onClick={onOpenSettings} type="button"><SettingsIcon /></button></header>
      <main className="bf-content">{children}</main>
      <footer className="bf-app-footer">
        <dl aria-label="Software versions" className="bf-app-footer__versions">
          <div><dt>App</dt><dd>{appVersion}</dd></div>
          <div><dt>Calculation engine</dt><dd>{engineVersion}</dd></div>
        </dl>
        <nav aria-label="Project links">
          <ul className="bf-app-footer__links">
            {projectLinks.map((link) => <li key={link.href}><a href={link.href} rel="noopener noreferrer" target="_blank">{link.label}<span className="bf-sr-only"> (opens in a new tab)</span></a></li>)}
          </ul>
        </nav>
      </footer>
    </div>
    {navigationButtons("bottom")}
  </div>;
}

export function PageHeader({ eyebrow, tone, title, description, actions }: { readonly eyebrow?: string; readonly tone?: "warning" | "danger"; readonly title: string; readonly description?: string; readonly actions?: ReactNode }) {
  return <header className="bf-page-header"><div>{eyebrow && <p className={`bf-eyebrow${tone ? ` bf-eyebrow--${tone}` : ""}`}>{eyebrow}</p>}<h1>{title}</h1>{description && <p className="bf-page-header__description">{description}</p>}</div>{actions && <div className="bf-page-header__actions">{actions}</div>}</header>;
}

export function SegmentedControl<T extends string>({ label, value, options, onChange }: { readonly label: string; readonly value: T; readonly options: readonly { readonly value: T; readonly label: string; readonly disabled?: boolean }[]; readonly onChange?: (value: T) => void }) {
  const id = useId();
  return <fieldset className="bf-segmented"><legend>{label}</legend><div role="radiogroup" aria-label={label}>{options.map((option) => <label data-selected={option.value === value || undefined} key={option.value}><input checked={option.value === value} disabled={option.disabled} name={id} onChange={() => onChange?.(option.value)} type="radio" value={option.value} /><span>{option.label}</span></label>)}</div></fieldset>;
}

export function FieldGroup({ label, hint, error, children }: { readonly label: string; readonly hint?: string; readonly error?: string; readonly children: ReactNode }) {
  const id = useId();
  return <div aria-labelledby={id} className="bf-field-group" role="group"><span id={id}>{label}</span><div className="bf-field-group__control">{children}</div>{error ? <p className="bf-field-group__error">{error}</p> : hint && <p className="bf-field-group__hint">{hint}</p>}</div>;
}

export function Panel({ title, eyebrow, actions, children, className = "" }: { readonly title?: string; readonly eyebrow?: string; readonly actions?: ReactNode; readonly children: ReactNode; readonly className?: string }) {
  return <section className={`bf-panel ${className}`.trim()}>{(title || eyebrow || actions) && <header className="bf-panel__header"><div>{eyebrow && <p className="bf-eyebrow">{eyebrow}</p>}{title && <h2>{title}</h2>}</div>{actions}</header>}<div className="bf-panel__body">{children}</div></section>;
}

export function ResultMetric({ label, value, detail, tone = "default", kind = "number" }: { readonly label: string; readonly value: string; readonly detail?: string; readonly tone?: "default" | "safe" | "warning" | "danger"; readonly kind?: "number" | "text" }) {
  return <div className={`bf-metric bf-metric--${kind}`} data-tone={tone}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export type WarningItem = { readonly id: string; readonly message: string; readonly severity?: "info" | "warning" | "error" };
export function WarningList({ items, title = "Planning notes" }: { readonly items: readonly WarningItem[]; readonly title?: string }) {
  const titleId = useId();
  if (!items.length) return null;
  const tone = items.some((item) => item.severity === "error") ? "danger" : items.every((item) => item.severity === "info") ? "info" : "warning";
  return <section className="bf-warnings" aria-labelledby={titleId} data-tone={tone}><h2 id={titleId}>{title}</h2><ul>{items.map((item) => <li data-severity={item.severity ?? "warning"} key={item.id}>{item.message}</li>)}</ul></section>;
}

export function GasChip({ name, oxygen, helium, role }: { readonly name: string; readonly oxygen: number; readonly helium?: number; readonly role?: string }) {
  return <span className="bf-gas-chip" title={role}><strong>{name}</strong><span>O₂ {oxygen}%{helium ? ` · He ${helium}%` : ""}</span></span>;
}

export function CylinderSummary({ name, gas, pressure, workingPressure, reservePressure, status }: { readonly name: string; readonly gas: ReactNode; readonly pressure: string; readonly workingPressure?: string; readonly reservePressure?: string; readonly status?: "ready" | "reserve" | "low" }) {
  return <article className="bf-cylinder" data-status={status ?? "ready"}><div><h3>{name}</h3>{gas}</div><dl><div><dt>Pressure</dt><dd>{pressure}</dd></div>{workingPressure && <div><dt>Rated</dt><dd>{workingPressure}</dd></div>}{reservePressure && <div><dt>Reserve</dt><dd>{reservePressure}</dd></div>}</dl></article>;
}

export function EmptyState({ title, description, action }: { readonly title: string; readonly description: string; readonly action?: ReactNode }) {
  return <section className="bf-empty-state"><h2>{title}</h2><p>{description}</p>{action}</section>;
}

export function CompletionNotice({ label, description, actions, containerRef }: {
  readonly label: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly containerRef?: RefObject<HTMLDivElement | null>;
}) {
  return <div className="bf-completion-notice" ref={containerRef}>
    <span aria-hidden="true" className="bf-completion-notice__perimeter">
      <span className="bf-completion-notice__edge bf-completion-notice__edge--top" />
      <span className="bf-completion-notice__edge bf-completion-notice__edge--right" />
      <span className="bf-completion-notice__edge bf-completion-notice__edge--bottom" />
      <span className="bf-completion-notice__edge bf-completion-notice__edge--left" />
    </span>
    <span aria-atomic="true" aria-live="polite" className="bf-completion-notice__copy" role="status">
      <strong>{label}</strong>
      {description && <span>{description}</span>}
    </span>
    {actions && <div className="bf-completion-notice__actions">{actions}</div>}
  </div>;
}

function useModalKeyboard<T extends HTMLElement>(open: boolean, onCancel: (() => void) | undefined, ref: RefObject<T | null>) {
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
    const initial = ref.current?.querySelector<HTMLElement>("[data-initial-focus], input, button");
    initial?.focus();
    return () => previousFocus?.focus();
  }, [open, ref]);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel?.();
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;
    const focusable = [...ref.current.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return onKeyDown;
}

export function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", danger, onConfirm, onCancel }: { readonly open: boolean; readonly title: string; readonly description: string; readonly confirmLabel?: string; readonly cancelLabel?: string; readonly danger?: boolean; readonly onConfirm?: () => void; readonly onCancel?: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const onKeyDown = useModalKeyboard(open, onCancel, dialogRef);
  if (!open) return null;
  return <div className="bf-dialog-backdrop" role="presentation"><section aria-describedby={descriptionId} aria-labelledby={titleId} aria-modal="true" className="bf-dialog" onKeyDown={onKeyDown} ref={dialogRef} role="dialog"><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p><div className="bf-dialog__actions"><button className="bf-button bf-button--quiet" data-initial-focus onClick={onCancel} type="button">{cancelLabel}</button><button className={`bf-button ${danger ? "bf-button--danger" : ""}`} onClick={onConfirm} type="button">{confirmLabel}</button></div></section></div>;
}

export function SavePlanDialog({ open, defaultName = "", onSave, onCancel }: { readonly open: boolean; readonly defaultName?: string; readonly onSave?: (name: string) => void; readonly onCancel?: () => void }) {
  const id = useId();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const onKeyDown = useModalKeyboard(open, onCancel, dialogRef);
  if (!open) return null;
  return <div className="bf-dialog-backdrop" role="presentation"><form aria-describedby={descriptionId} aria-labelledby={titleId} aria-modal="true" className="bf-dialog" onKeyDown={onKeyDown} onSubmit={(event) => { event.preventDefault(); const name = new FormData(event.currentTarget).get("name"); if (typeof name === "string" && name.trim()) onSave?.(name.trim()); }} ref={dialogRef} role="dialog"><h2 id={titleId}>Save dive plan</h2><p id={descriptionId}>Store this immutable plan snapshot locally on this device.</p><label className="bf-dialog__input" htmlFor={id}>Plan name<input data-initial-focus defaultValue={defaultName} id={id} name="name" required type="text" /></label><div className="bf-dialog__actions"><button className="bf-button bf-button--quiet" onClick={onCancel} type="button">Cancel</button><button className="bf-button" type="submit">Save plan</button></div></form></div>;
}

export type RuntimeRow = { readonly runtime: string; readonly depth: string; readonly duration: string; readonly gas?: ReactNode; readonly event: string };
export function RuntimeSchedule({ rows }: { readonly rows: readonly RuntimeRow[] }) {
  return <div className="bf-scroll-table"><table className="bf-schedule"><caption>Runtime schedule</caption><thead><tr><th>Runtime</th><th>Depth</th><th>Time</th><th>Gas</th><th>Instruction</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.runtime}-${index}`}><td>{row.runtime}</td><td>{row.depth}</td><td>{row.duration}</td><td>{row.gas ?? "—"}</td><td>{row.event}</td></tr>)}</tbody></table></div>;
}

export type GasLedgerRow = { readonly gas: ReactNode; readonly used: string; readonly reserve?: string; readonly remaining?: string; readonly status: "ok" | "warning" | "short" };
export function GasLedger({ rows }: { readonly rows: readonly GasLedgerRow[] }) {
  return <div className="bf-scroll-table"><table className="bf-ledger"><caption>Gas ledger</caption><thead><tr><th>Gas</th><th>Used</th><th>Reserve</th><th>Remaining</th><th>Status</th></tr></thead><tbody>{rows.map((row, index) => <tr data-status={row.status} key={index}><td>{row.gas}</td><td>{row.used}</td><td>{row.reserve ?? "—"}</td><td>{row.remaining ?? "—"}</td><td>{row.status === "ok" ? "Sufficient" : row.status === "warning" ? "Review" : "Short"}</td></tr>)}</tbody></table></div>;
}
