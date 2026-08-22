import type { ReactNode } from "react";
import { FieldGroup } from "../ui";

export function ActionButton({
  children,
  onClick,
  quiet = false,
  danger = false,
  disabled = false,
  type = "button",
}: {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly quiet?: boolean;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly type?: "button" | "submit";
}) {
  return <button
    className={`bf-button${quiet ? " bf-button--quiet" : ""}${danger ? " bf-button--danger" : ""}`}
    disabled={disabled}
    onClick={onClick}
    type={type}
  >{children}</button>;
}

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  hint,
  disabled,
}: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly step?: number;
  readonly min?: number;
  readonly max?: number;
  readonly hint?: string;
  readonly disabled?: boolean;
}) {
  return <FieldGroup label={label} hint={hint}>
    <input
      aria-label={label}
      disabled={disabled}
      max={max}
      min={min}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
      step={step}
      type="number"
      value={Number.isFinite(value) ? value : ""}
    />
  </FieldGroup>;
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}) {
  return <FieldGroup label={label}>
    <input
      aria-label={label}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
      placeholder={placeholder}
      type="text"
      value={value}
    />
  </FieldGroup>;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly hint?: string;
}) {
  return <FieldGroup label={label} hint={hint}>
    <select aria-label={label} onChange={(event) => onChange(event.currentTarget.value as T)} value={value}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </FieldGroup>;
}

export function ToggleField({
  label,
  checked,
  onChange,
  hint,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly hint?: string;
}) {
  return <label className="bf-toggle">
    <input checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} type="checkbox" />
    <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
  </label>;
}
