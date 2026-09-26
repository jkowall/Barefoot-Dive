import { useRef, type ReactNode } from "react";
import type { Meters } from "../domain/types";
import { FieldGroup } from "../ui";
import { depthInputStep, depthInputValue, resolveDepthEntry, type DepthEntryBound, type UnitPreferences } from "./helpers";

export function ActionButton({
  children,
  onClick,
  quiet = false,
  danger = false,
  small = false,
  disabled = false,
  type = "button",
}: {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly quiet?: boolean;
  readonly danger?: boolean;
  readonly small?: boolean;
  readonly disabled?: boolean;
  readonly type?: "button" | "submit";
}) {
  return <button
    className={`bf-button${quiet ? " bf-button--quiet" : ""}${danger ? " bf-button--danger" : ""}${small ? " bf-button--sm" : ""}`}
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
  error,
  disabled,
  onBlur,
}: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly step?: number;
  readonly min?: number;
  readonly max?: number;
  readonly hint?: string;
  readonly error?: string;
  readonly disabled?: boolean;
  readonly onBlur?: () => void;
}) {
  return <FieldGroup error={error} label={label} hint={hint}>
    <input
      aria-label={label}
      disabled={disabled}
      max={max}
      min={min}
      onBlur={onBlur}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
      step={step}
      type="number"
      value={Number.isFinite(value) ? value : ""}
    />
  </FieldGroup>;
}

/**
 * A depth or distance field in the display unit (whole feet, or metres to one decimal).
 *
 * The stored metres are captured when the field takes focus. The field reports every keystroke,
 * so without this, retyping the displayed value would compare against the partial entry instead
 * (typing "20" passes through "2"). Retyping the value shown on focus keeps the stored depth exactly.
 */
export function DepthField({
  label,
  valueM,
  units,
  onChange,
  bound = "free",
  gridM,
  min,
  hint,
  error,
  disabled,
}: {
  readonly label: string;
  readonly valueM: number;
  readonly units: UnitPreferences["depth"];
  readonly onChange: (value: Meters) => void;
  readonly bound?: DepthEntryBound;
  /** Stop grid for switch-depth aliasing; the plan's stop increment. */
  readonly gridM?: number;
  readonly min?: number;
  readonly hint?: string;
  readonly error?: string;
  readonly disabled?: boolean;
}) {
  const focusM = useRef<number | undefined>(undefined);
  return <FieldGroup error={error} label={label} hint={hint}>
    <input
      aria-label={label}
      disabled={disabled}
      min={min}
      onBlur={() => { focusM.current = undefined; }}
      onChange={(event) => onChange(resolveDepthEntry(Number(event.currentTarget.value), units, {
        focusM: focusM.current ?? valueM,
        gridM,
        bound,
      }))}
      onFocus={() => { focusM.current = valueM; }}
      step={depthInputStep(units)}
      type="number"
      value={Number.isFinite(valueM) ? depthInputValue(valueM, units) : ""}
    />
  </FieldGroup>;
}

/** A number field that stays blank until a value is entered; blank reports undefined, never 0. */
export function OptionalNumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  hint,
  error,
}: {
  readonly label: string;
  readonly value: number | undefined;
  readonly onChange: (value: number | undefined) => void;
  readonly step?: number;
  readonly min?: number;
  readonly hint?: string;
  readonly error?: string;
}) {
  return <FieldGroup error={error} label={label} hint={hint}>
    <input
      aria-label={label}
      min={min}
      onChange={(event) => {
        const text = event.currentTarget.value.trim();
        onChange(text === "" ? undefined : Number(text));
      }}
      step={step}
      type="number"
      value={value !== undefined && Number.isFinite(value) ? value : ""}
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
