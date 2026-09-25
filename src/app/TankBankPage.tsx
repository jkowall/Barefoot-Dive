/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import { calculateMOD } from "../calculations";
import { DEFAULT_ENVIRONMENT } from "../domain/defaults";
import type { CylinderRole, Gas } from "../domain/types";
import { barAbsolute, barGauge, fraction, liters } from "../domain/units";
import {
  CompletionNotice,
  ConfirmDialog,
  EmptyState,
  FieldGroup,
  PageHeader,
  Panel,
  ResultMetric,
  SegmentedControl,
  WarningList,
  type WarningItem,
} from "../ui";
import {
  capacityInputValue,
  capacityLabel,
  capacityUnit,
  depthInputValue,
  depthUnit,
  formatPressure,
  pressureInputStep,
  pressureInputToCanonical,
  pressureInputValue,
  ratedCapacityFromCanonical,
  waterVolumeFromRatedCapacity,
  type UnitPreferences,
} from "./helpers";
import { ActionButton } from "./controls";
import type { TankBankStore } from "../storage/tankBank";
import type {
  TankDraft,
  TankRecord,
  StorageDiagnostic,
} from "../storage/types";

function failureMessage(error: StorageDiagnostic): string {
  return `${error.message} (${error.code})`;
}
const clip = (text: string) => (text.length > 60 ? `${text.slice(0, 59)}…` : text);
function quarantineItems(diagnostics: readonly StorageDiagnostic[]): WarningItem[] {
  return [
    ...diagnostics.map((item, index): WarningItem => {
      const record = item.record;
      if (!record) return { id: `quarantined-${index}`, message: item.message, severity: "warning" };
      const label = record.name || record.id;
      const subject = `Stored record ${record.index + 1}${label ? ` (“${clip(label)}”)` : ""}`;
      return {
        id: `quarantined-${record.index}`,
        message: record.fields.includes("record")
          ? `${subject} is not a cylinder record.`
          : `${subject} has missing or invalid fields: ${record.fields.join(", ")}.`,
        severity: "warning",
      };
    }),
    {
      id: "quarantine-handling",
      message: "Quarantined records stay unchanged in local storage and are not listed here or offered to Plan, Cave, or Tools. Valid cylinders load normally; re-create a quarantined cylinder to plan with it.",
      severity: "info",
    },
  ];
}

export type TankBankPageProps = {
  readonly store: TankBankStore;
  readonly units: UnitPreferences;
  readonly onError: (message: string, error?: StorageDiagnostic) => void;
  readonly onSelectCylinder?: (record: TankRecord) => void;
  readonly onRecordsChange?: (records: readonly TankRecord[]) => void;
};
type DraftState = {
  name: string;
  waterVolumeL: number;
  workingPressureBar: number;
  currentPressureBar: number;
  minimumPressureBar: number;
  oxygen: number;
  helium: number;
  maximumPPO2: number;
  role: CylinderRole;
  gasName: string;
};
const roles: readonly CylinderRole[] = [
  "bottom",
  "travel",
  "deco",
  "bailout",
  "diluent",
  "stage",
];
const emptyDraft: DraftState = {
  name: "New cylinder",
  waterVolumeL: 24,
  workingPressureBar: 232,
  currentPressureBar: 232,
  minimumPressureBar: 35,
  oxygen: 21,
  helium: 0,
  maximumPPO2: 1.6,
  role: "bottom",
  gasName: "Air",
};

function draftFromRecord(record: TankRecord): DraftState {
  return {
    name: record.name,
    waterVolumeL: record.waterVolumeL,
    workingPressureBar: record.workingPressureBar,
    currentPressureBar: record.currentPressureBar,
    minimumPressureBar: record.minimumPressureBar ?? 0,
    oxygen: record.gas.oxygen * 100,
    helium: record.gas.helium * 100,
    maximumPPO2: record.maximumPPO2,
    role: record.role ?? record.gas.role,
    gasName: record.gas.name,
  };
}
function toDraft(draft: DraftState, source?: TankRecord): TankDraft {
  const gas: Gas = {
    id:
      source?.gas.id ??
      (draft.gasName
        .trim()
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-") ||
        "gas"),
    name: draft.gasName.trim() || "Unnamed gas",
    oxygen: fraction(draft.oxygen / 100),
    helium: fraction(draft.helium / 100),
    role: draft.role === "stage" ? "bottom" : draft.role,
    ...(source?.gas.switchDepthM === undefined
      ? {}
      : { switchDepthM: source.gas.switchDepthM }),
  };
  return {
    name: draft.name.trim(),
    waterVolumeL: liters(draft.waterVolumeL),
    workingPressureBar: barGauge(draft.workingPressureBar),
    currentPressureBar: barGauge(draft.currentPressureBar),
    minimumPressureBar: barGauge(draft.minimumPressureBar),
    maximumPPO2: barAbsolute(draft.maximumPPO2),
    role: draft.role,
    gas,
  };
}
function validateDraft(draft: DraftState): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("Cylinder name is required.");
  if (!draft.gasName.trim()) errors.push("Gas name is required.");
  if (!Number.isFinite(draft.waterVolumeL) || draft.waterVolumeL <= 0)
    errors.push("Water volume must be greater than zero.");
  if (
    !Number.isFinite(draft.workingPressureBar) ||
    draft.workingPressureBar <= 0
  )
    errors.push("Working pressure must be greater than zero.");
  if (
    !Number.isFinite(draft.currentPressureBar) ||
    draft.currentPressureBar < 0 ||
    draft.currentPressureBar > draft.workingPressureBar
  )
    errors.push("Current pressure must be between zero and working pressure.");
  if (
    !Number.isFinite(draft.minimumPressureBar) ||
    draft.minimumPressureBar < 0 ||
    draft.minimumPressureBar > draft.currentPressureBar
  )
    errors.push("Minimum pressure must be between zero and current pressure.");
  if (!Number.isFinite(draft.oxygen) || draft.oxygen <= 0 || draft.oxygen > 100)
    errors.push("O₂ must be greater than 0% and at most 100%.");
  if (
    !Number.isFinite(draft.helium) ||
    draft.helium < 0 ||
    draft.helium > 100 ||
    draft.oxygen + draft.helium > 100
  )
    errors.push("O₂ and He must be valid fractions totaling at most 100%.");
  if (!Number.isFinite(draft.maximumPPO2) || draft.maximumPPO2 <= 0)
    errors.push("Maximum PPO₂ must be greater than zero.");
  return errors;
}

export function TankBankPage({
  store,
  units,
  onError,
  onSelectCylinder,
  onRecordsChange,
}: TankBankPageProps) {
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<CylinderRole | "">("");
  const [gas, setGas] = useState("");
  const [records, setRecords] = useState<readonly TankRecord[]>([]);
  const [editing, setEditing] = useState<{ id?: string; draft: DraftState }>();
  const [completion, setCompletion] = useState<{ readonly revision: number; readonly label: string; readonly description: string }>();
  const [errors, setErrors] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<TankRecord>();
  const [quarantined, setQuarantined] = useState<readonly StorageDiagnostic[]>([]);
  const [readError, setReadError] = useState<StorageDiagnostic>();
  const filtered = Boolean(search.trim() || gas.trim() || role);
  const refresh = useCallback(() => {
    const result = store.list({
      archived,
      search,
      gas,
      ...(role ? { role } : {}),
    });
    if (!result.ok) {
      setReadError(result.error);
      setQuarantined([]);
      setRecords([]);
      onError(failureMessage(result.error), result.error);
      return;
    }
    setReadError(undefined);
    setQuarantined(result.diagnostics.filter((item) => item.code === "STORAGE_RECORD_QUARANTINED"));
    setRecords(result.value);
    onRecordsChange?.(result.value);
  }, [archived, gas, onError, onRecordsChange, role, search, store]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const mutate = (
    result:
      | ReturnType<TankBankStore["create"]>
      | ReturnType<TankBankStore["edit"]>
      | ReturnType<TankBankStore["duplicate"]>
      | ReturnType<TankBankStore["archive"]>
      | ReturnType<TankBankStore["restore"]>
      | ReturnType<TankBankStore["delete"]>,
  ) => {
    if (!result.ok) {
      onError(failureMessage(result.error), result.error);
      return false;
    }
    setCompletion(undefined);
    refresh();
    return true;
  };
  const save = () => {
    if (!editing) return;
    const nextErrors = validateDraft(editing.draft);
    setErrors(nextErrors);
    if (nextErrors.length) return;
    const result = editing.id
      ? store.edit(
          editing.id,
          toDraft(
            editing.draft,
            records.find((record) => record.id === editing.id),
          ),
        )
      : store.create(toDraft(editing.draft));
    if (mutate(result)) {
      setCompletion((current) => ({
        revision: (current?.revision ?? 0) + 1,
        label: editing.id ? "Cylinder updated locally" : "Cylinder saved locally",
        description: `${editing.draft.name.trim()} is now available in Tank Bank.`,
      }));
      setEditing(undefined);
    }
  };
  const formatVolume = (record: TankRecord) =>
    `${ratedCapacityFromCanonical(record.waterVolumeL, record.workingPressureBar, units.cylinderCapacity).toFixed(1)} ${capacityUnit(units.cylinderCapacity)} ${units.cylinderCapacity === "imperial" ? "rated at working pressure" : "water volume"}`;
  const beginEdit = (record?: TankRecord) => {
    setCompletion(undefined);
    setErrors([]);
    setEditing({
      ...(record?.id ? { id: record.id } : {}),
      draft: record ? draftFromRecord(record) : emptyDraft,
    });
  };
  const roleOptions = [
    { value: "", label: "All roles" },
    ...roles.map((value) => ({
      value,
      label: value[0].toUpperCase() + value.slice(1),
    })),
  ] as const;
  const mod = (record: TankRecord) => {
    const result = calculateMOD({
      oxygen: record.gas.oxygen,
      maximumPPO2: record.maximumPPO2,
      ...DEFAULT_ENVIRONMENT,
    });
    return result.ok
      ? `${depthInputValue(result.value.depthM, units.depth)} ${depthUnit(units.depth)}`
      : "—";
  };
  const cylinderCapacityLabel = capacityLabel(units.cylinderCapacity);
  return (
    <>
      <PageHeader
        title="Tank Bank"
        description="Keep analyzed cylinders ready for explicit planner assignment."
        actions={<ActionButton disabled={Boolean(readError)} onClick={() => beginEdit()}>Add cylinder</ActionButton>}
      />
      {completion && <CompletionNotice description={completion.description} key={completion.revision} label={completion.label} />}
      {quarantined.length > 0 && <WarningList items={quarantineItems(quarantined)} title="Quarantined cylinder records" />}
      <Panel>
        <div className="bf-form-grid bf-form-grid--filters">
          <SegmentedControl
            label="View"
            options={[
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
            ]}
            value={archived ? "archived" : "active"}
            onChange={(value) => setArchived(value === "archived")}
          />
          <FieldGroup label="Search">
            <input
              aria-label="Search tanks"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, id, or gas"
              value={search}
            />
          </FieldGroup>
          <FieldGroup label="Role">
            <select
              aria-label="Filter by role"
              onChange={(event) =>
                setRole(event.target.value as CylinderRole | "")
              }
              value={role}
            >
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FieldGroup>
          <FieldGroup label="Gas">
            <input
              aria-label="Filter by gas"
              onChange={(event) => setGas(event.target.value)}
              placeholder="Gas name"
              value={gas}
            />
          </FieldGroup>
        </div>
      </Panel>
      {readError ? (
        <EmptyState
          description={`${failureMessage(readError)} The stored data has not been changed, and cylinders cannot be added or edited until it can be read.`}
          title="Tank Bank could not be read"
        />
      ) : records.length === 0 ? (
        <EmptyState
          description={
            filtered
              ? "No cylinder matches the current search and filters."
              : archived
                ? "Archived cylinders will appear here."
                : "Create a cylinder to make planner assignments explicit."
          }
          title={filtered ? "No matching cylinders" : archived ? "No archived cylinders" : quarantined.length > 0 ? "No usable cylinders" : "Tank Bank is empty"}
        />
      ) : (
        <div className="bf-card-grid">
          {records.map((record) => (
            <Panel
              className="bf-tank-card"
              key={record.id}
              title={record.name}
              eyebrow={`${record.gas.name} · ${record.role ?? record.gas.role}`}
              actions={
                <div className="bf-tank-card__actions">
                  <ActionButton
                    small
                    onClick={() => onSelectCylinder?.(record)}
                    quiet
                    disabled={!onSelectCylinder}
                  >
                    Use
                  </ActionButton>
                  <ActionButton small onClick={() => beginEdit(record)} quiet>
                    Edit
                  </ActionButton>
                  <ActionButton
                    small
                    onClick={() => mutate(store.duplicate(record.id))}
                    quiet
                  >
                    Duplicate
                  </ActionButton>
                  {archived ? (
                    <ActionButton
                      small
                      onClick={() => mutate(store.restore(record.id))}
                      quiet
                    >
                      Restore
                    </ActionButton>
                  ) : (
                    <ActionButton
                      small
                      onClick={() => mutate(store.archive(record.id))}
                      quiet
                    >
                      Archive
                    </ActionButton>
                  )}
                  <ActionButton danger small onClick={() => setConfirm(record)} quiet>
                    Delete
                  </ActionButton>
                </div>
              }
            >
              <div className="bf-metric-grid">
                <ResultMetric
                  label="Gas"
                  value={`${Math.round(record.gas.oxygen * 100)}/${Math.round(record.gas.helium * 100)}`}
                  detail={`O₂ ${Math.round(record.gas.oxygen * 100)}% · He ${Math.round(record.gas.helium * 100)}%`}
                />
                <ResultMetric
                  label="Current"
                  value={formatPressure(record.currentPressureBar, units.pressure)}
                  detail={formatVolume(record)}
                />
                <ResultMetric
                  label="MOD"
                  value={mod(record)}
                  detail={`Max PPO₂ ${record.maximumPPO2.toFixed(2)} bar`}
                />
              </div>
            </Panel>
          ))}
        </div>
      )}
      {editing && (
        <Panel
          title={editing.id ? "Edit cylinder" : "New cylinder"}
          eyebrow="Analyzer-first equipment record"
        >
          <div className="bf-form-grid">
            <FieldGroup
              label="Name"
              error={errors.find((item) => item.includes("name"))}
            >
              <input
                aria-label="Cylinder name"
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    draft: { ...editing.draft, name: event.target.value },
                  })
                }
                value={editing.draft.name}
              />
            </FieldGroup>
            <FieldGroup label="Gas name">
              <input
                aria-label="Gas name"
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    draft: { ...editing.draft, gasName: event.target.value },
                  })
                }
                value={editing.draft.gasName}
              />
            </FieldGroup>
            <FieldGroup
              label={cylinderCapacityLabel}
              hint={
                units.cylinderCapacity === "imperial"
                  ? "Rated surface capacity is converted with the cylinder working pressure."
                  : "Physical internal water volume used by metric cylinder specifications."
              }
            >
              <input
                aria-label={cylinderCapacityLabel}
                min={0}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    draft: {
                      ...editing.draft,
                      waterVolumeL: waterVolumeFromRatedCapacity(
                        Number(event.target.value),
                        editing.draft.workingPressureBar,
                        units.cylinderCapacity,
                      ),
                    },
                  })
                }
                step={0.1}
                type="number"
                value={capacityInputValue(
                  editing.draft.waterVolumeL,
                  editing.draft.workingPressureBar,
                  units.cylinderCapacity,
                )}
              />
            </FieldGroup>
            <FieldGroup label={`Working pressure (${units.pressure})`}>
              <input
                aria-label={`Working pressure (${units.pressure})`}
                min={0}
                onChange={(event) => {
                  const capacity = ratedCapacityFromCanonical(
                    editing.draft.waterVolumeL,
                    editing.draft.workingPressureBar,
                    units.cylinderCapacity,
                  );
                  const workingPressureBar = pressureInputToCanonical(
                    Number(event.target.value),
                    units.pressure,
                    [
                      editing.draft.workingPressureBar,
                      editing.draft.currentPressureBar,
                    ],
                  );
                  setEditing({
                    ...editing,
                    draft: {
                      ...editing.draft,
                      workingPressureBar,
                      waterVolumeL: waterVolumeFromRatedCapacity(
                        capacity,
                        workingPressureBar,
                        units.cylinderCapacity,
                      ),
                    },
                  });
                }}
                step={pressureInputStep(units.pressure)}
                type="number"
                value={pressureInputValue(
                  editing.draft.workingPressureBar,
                  units.pressure,
                )}
              />
            </FieldGroup>
            {(
              [
                ["currentPressureBar", `Current pressure (${units.pressure})`],
                ["minimumPressureBar", `Minimum pressure (${units.pressure})`],
                ["oxygen", "O₂ (%)"],
                ["helium", "He (%)"],
                ["maximumPPO2", "Maximum PPO₂ (bar)"],
              ] as const
            ).map(([key, label]) => (
              <FieldGroup key={key} label={label}>
                <input
                  aria-label={label}
                  min={0}
                  onChange={(event) => {
                    const inputValue = Number(event.target.value);
                    const pressureEquivalents = key === "currentPressureBar"
                      ? [editing.draft.currentPressureBar, editing.draft.workingPressureBar]
                      : key === "minimumPressureBar"
                        ? [editing.draft.minimumPressureBar, editing.draft.currentPressureBar]
                        : [];
                    setEditing({
                      ...editing,
                      draft: {
                        ...editing.draft,
                        [key]: key.endsWith("PressureBar")
                          ? pressureInputToCanonical(inputValue, units.pressure, pressureEquivalents)
                          : inputValue,
                      },
                    });
                  }}
                  step={
                    key === "maximumPPO2"
                      ? 0.05
                      : key === "oxygen" || key === "helium"
                        ? 1
                        : pressureInputStep(units.pressure)
                  }
                  type="number"
                  value={
                    key.endsWith("PressureBar")
                      ? pressureInputValue(
                          editing.draft[key],
                          units.pressure,
                        )
                      : editing.draft[key]
                  }
                />
              </FieldGroup>
            ))}
            <FieldGroup label="Role">
              <select
                aria-label="Cylinder role"
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    draft: {
                      ...editing.draft,
                      role: event.target.value as CylinderRole,
                    },
                  })
                }
                value={editing.draft.role}
              >
                {roles.map((item) => (
                  <option key={item} value={item}>
                    {item[0].toUpperCase() + item.slice(1)}
                  </option>
                ))}
              </select>
            </FieldGroup>
          </div>
          {errors.length > 0 && (
            <ul className="bf-field-group__error">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          <ActionButton disabled={Boolean(readError)} onClick={save}>Save cylinder</ActionButton>
          <ActionButton onClick={() => setEditing(undefined)} quiet>
            Cancel
          </ActionButton>
        </Panel>
      )}
      <ConfirmDialog
        danger
        confirmLabel="Delete cylinder"
        description={`Delete “${confirm?.name ?? "this cylinder"}” permanently from the local Tank Bank.`}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => {
          if (confirm) {
            const result = store.delete(confirm.id);
            if (mutate(result)) setConfirm(undefined);
          }
        }}
        open={Boolean(confirm)}
        title="Delete this cylinder?"
      />
    </>
  );
}
