import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useMemo, useRef } from "react";

export type RouteKey = "plan" | "cave" | "tools" | "tanks" | "plans";

export type NavigationItem = {
  readonly key: RouteKey;
  readonly label: string;
  readonly badge?: string | number;
};

const defaultNavigation: readonly NavigationItem[] = [
  { key: "plan", label: "Plan" },
  { key: "cave", label: "Cave" },
  { key: "tools", label: "Tools" },
  { key: "tanks", label: "Tank bank" },
  { key: "plans", label: "Saved plans" },
];

export function AppShell({ children, activeRoute, navigation = defaultNavigation, onNavigate, onOpenSettings, title = "Barefoot Dive" }: {
  readonly children: ReactNode;
  readonly activeRoute: RouteKey;
  readonly navigation?: readonly NavigationItem[];
  readonly onNavigate?: (route: RouteKey) => void;
  readonly onOpenSettings?: () => void;
  readonly title?: string;
}) {
  const navigationButtons = (location: "rail" | "bottom") => (
    <nav className={`bf-nav bf-nav--${location}`} aria-label="Primary navigation">
      {navigation.map((item) => <button aria-current={item.key === activeRoute ? "page" : undefined} className="bf-nav__item" data-active={item.key === activeRoute || undefined} key={item.key} onClick={() => onNavigate?.(item.key)} type="button">
        <span>{item.label}</span>{item.badge !== undefined && <span className="bf-nav__badge">{item.badge}</span>}
      </button>)}
    </nav>
  );
  return <div className="bf-app-shell">
    <aside className="bf-rail"><div className="bf-brand"><img alt="" aria-hidden="true" className="bf-brand__mark" src="/logo-64.png" /><span><small>BAREFOOT</small><strong>Dive</strong></span></div>{navigationButtons("rail")}</aside>
    <div className="bf-workspace"><header className="bf-topbar"><div className="bf-topbar__title">{title}</div><button aria-label="Open settings" className="bf-icon-button" onClick={onOpenSettings} type="button">⚙</button></header><main className="bf-content">{children}</main></div>
    {navigationButtons("bottom")}
  </div>;
}

export function PageHeader({ eyebrow, title, description, actions }: { readonly eyebrow?: string; readonly title: string; readonly description?: string; readonly actions?: ReactNode }) {
  return <header className="bf-page-header"><div>{eyebrow && <p className="bf-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="bf-page-header__description">{description}</p>}</div>{actions && <div className="bf-page-header__actions">{actions}</div>}</header>;
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

export function ResultMetric({ label, value, detail, tone = "default" }: { readonly label: string; readonly value: string; readonly detail?: string; readonly tone?: "default" | "safe" | "warning" | "danger" }) {
  return <div className="bf-metric" data-tone={tone}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export type WarningItem = { readonly id: string; readonly message: string; readonly severity?: "info" | "warning" | "error" };
export function WarningList({ items, title = "Planning notes" }: { readonly items: readonly WarningItem[]; readonly title?: string }) {
  const titleId = useId();
  if (!items.length) return null;
  return <section className="bf-warnings" aria-labelledby={titleId}><h2 id={titleId}>{title}</h2><ul>{items.map((item) => <li data-severity={item.severity ?? "warning"} key={item.id}>{item.message}</li>)}</ul></section>;
}

export function GasChip({ name, oxygen, helium, role }: { readonly name: string; readonly oxygen: number; readonly helium?: number; readonly role?: string }) {
  return <span className="bf-gas-chip" title={role}><strong>{name}</strong><span>O₂ {oxygen}%{helium ? ` · He ${helium}%` : ""}</span></span>;
}

export function CylinderSummary({ name, gas, pressure, workingPressure, reservePressure, status }: { readonly name: string; readonly gas: ReactNode; readonly pressure: string; readonly workingPressure?: string; readonly reservePressure?: string; readonly status?: "ready" | "reserve" | "low" }) {
  return <article className="bf-cylinder" data-status={status ?? "ready"}><div><h3>{name}</h3>{gas}</div><dl><div><dt>Pressure</dt><dd>{pressure}</dd></div>{workingPressure && <div><dt>Rated</dt><dd>{workingPressure}</dd></div>}{reservePressure && <div><dt>Reserve</dt><dd>{reservePressure}</dd></div>}</dl></article>;
}

export function EmptyState({ title, description, action }: { readonly title: string; readonly description: string; readonly action?: ReactNode }) {
  return <section className="bf-empty-state"><span aria-hidden="true">⌁</span><h2>{title}</h2><p>{description}</p>{action}</section>;
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

export type ProfilePoint = { readonly runtime: string; readonly depth: number; readonly ceiling?: number; readonly label?: string };
export function ProfileChart({ points, title = "Dive profile", unit = "m" }: { readonly points: readonly ProfilePoint[]; readonly title?: string; readonly unit?: string }) {
  const { line, ceiling, maximum } = useMemo(() => {
    const maximum = Math.max(1, ...points.map((point) => Math.max(point.depth, point.ceiling ?? 0)));
    const mapped = (accessor: (point: ProfilePoint) => number | undefined) => points.map((point, index) => { const value = accessor(point); return value === undefined ? "" : `${(index / Math.max(1, points.length - 1)) * 100},${(value / maximum) * 100}`; }).filter(Boolean).join(" ");
    return { line: mapped((point) => point.depth), ceiling: mapped((point) => point.ceiling), maximum };
  }, [points]);
  return <section className="bf-profile" aria-labelledby="profile-title"><header><h2 id="profile-title">{title}</h2><span>Depth · {unit}</span></header><svg aria-label={`${title}; maximum depth ${maximum} ${unit}`} role="img" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="0" x2="100" y1="0" y2="0" /><line x1="0" x2="100" y1="50" y2="50" /><line x1="0" x2="100" y1="100" y2="100" />{ceiling && <polyline className="bf-profile__ceiling" points={ceiling} />}{line && <polyline className="bf-profile__line" points={line} />}</svg><div className="bf-scroll-table"><table><caption className="bf-sr-only">Dive profile data</caption><thead><tr><th>Runtime</th><th>Depth ({unit})</th><th>Ceiling ({unit})</th><th>Event</th></tr></thead><tbody>{points.map((point, index) => <tr key={`${point.runtime}-${index}`}><td>{point.runtime}</td><td>{point.depth}</td><td>{point.ceiling ?? "—"}</td><td>{point.label ?? "—"}</td></tr>)}</tbody></table></div></section>;
}

export type RuntimeRow = { readonly runtime: string; readonly depth: string; readonly duration: string; readonly gas?: ReactNode; readonly event: string };
export function RuntimeSchedule({ rows }: { readonly rows: readonly RuntimeRow[] }) {
  return <div className="bf-scroll-table"><table className="bf-schedule"><caption>Runtime schedule</caption><thead><tr><th>Runtime</th><th>Depth</th><th>Time</th><th>Gas</th><th>Instruction</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.runtime}-${index}`}><td>{row.runtime}</td><td>{row.depth}</td><td>{row.duration}</td><td>{row.gas ?? "—"}</td><td>{row.event}</td></tr>)}</tbody></table></div>;
}

export type GasLedgerRow = { readonly gas: ReactNode; readonly used: string; readonly reserve?: string; readonly remaining?: string; readonly status: "ok" | "warning" | "short" };
export function GasLedger({ rows }: { readonly rows: readonly GasLedgerRow[] }) {
  return <div className="bf-scroll-table"><table className="bf-ledger"><caption>Gas ledger</caption><thead><tr><th>Gas</th><th>Used</th><th>Reserve</th><th>Remaining</th><th>Status</th></tr></thead><tbody>{rows.map((row, index) => <tr data-status={row.status} key={index}><td>{row.gas}</td><td>{row.used}</td><td>{row.reserve ?? "—"}</td><td>{row.remaining ?? "—"}</td><td>{row.status === "ok" ? "Sufficient" : row.status === "warning" ? "Review" : "Short"}</td></tr>)}</tbody></table></div>;
}
