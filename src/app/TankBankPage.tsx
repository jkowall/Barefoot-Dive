/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import { calculateMOD } from "../calculations";
import { DEFAULT_ENVIRONMENT } from "../domain/defaults";
import type { CylinderRole } from "../domain/types";
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
  depthUnit,
  formatDepth,
  formatDepthBound,
  formatPressure,
  pressureInputStep,
  pressureInputToCanonical,
  pressureInputValue,
  ratedCapacityFromCanonical,
  waterVolumeFromRatedCapacity,
  type UnitPreferences,
} from "./helpers";
import { ActionButton, OptionalDepthField } from "./controls";
import { PLAN_STOP_INCREMENT_M } from "./planning";
import {
  draftStateFromRecord,
  EMPTY_TANK_BANK_DRAFT,
  roleStoresSwitchDepth,
  TANK_BANK_ROLES,
  tankBankDraftModM,
  toTankDraft,
  validateTankBankDraft,
  type TankBankDraftState,
} from "./tankBankDraft";
import type { TankBankStore } from "../storage/tankBank";
import type {
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
  const [editing, setEditing] = useState<{ id?: string; draft: TankBankDraftState }>();
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
    const nextErrors = validateTankBankDraft(editing.draft);
    setErrors(nextErrors);
    if (nextErrors.length) return;
    const result = editing.id
      ? store.edit(
          editing.id,
          toTankDraft(
            editing.draft,
            records.find((record) => record.id === editing.id),
          ),
        )
      : store.create(toTankDraft(editing.draft));
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
      draft: record ? draftStateFromRecord(record) : { ...EMPTY_TANK_BANK_DRAFT },
    });
  };
  const roleOptions = [
    { value: "", label: "All roles" },
    ...TANK_BANK_ROLES.map((value) => ({
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
      ? formatDepthBound(result.value.depthM, units.depth, "upper")
      : "—";
  };
  const cylinderCapacityLabel = capacityLabel(units.cylinderCapacity);
  const editingModM = editing ? tankBankDraftModM(editing.draft) : undefined;
  const switchDepthError = errors.find((item) => item.toLowerCase().includes("switch depth"));
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
                  detail={
                    record.gas.switchDepthM !== undefined && roleStoresSwitchDepth(record.role ?? record.gas.role)
                      ? `Switch ${formatDepth(record.gas.switchDepthM, units.depth)} · Max PPO₂ ${record.maximumPPO2.toFixed(2)} bar`
                      : `Max PPO₂ ${record.maximumPPO2.toFixed(2)} bar`
                  }
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
                onChange={(event) => {
                  const nextRole = event.target.value as CylinderRole;
                  setEditing({
                    ...editing,
                    draft: {
                      ...editing.draft,
                      role: nextRole,
                      ...(roleStoresSwitchDepth(nextRole)
                        ? {}
                        : { switchDepthM: undefined }),
                    },
                  });
                }}
                value={editing.draft.role}
              >
                {TANK_BANK_ROLES.map((item) => (
                  <option key={item} value={item}>
                    {item[0].toUpperCase() + item.slice(1)}
                  </option>
                ))}
              </select>
            </FieldGroup>
            {roleStoresSwitchDepth(editing.draft.role) && <>
              <OptionalDepthField
                bound="max-ppo2"
                error={switchDepthError}
                gridM={PLAN_STOP_INCREMENT_M}
                hint={editingModM === undefined
                  ? "Optional. Leave blank for no stored switch depth."
                  : `Optional. MOD at this max PPO₂ is ${formatDepthBound(editingModM, units.depth, "upper")}.`}
                label={`Switch depth (${depthUnit(units.depth)})`}
                min={0}
                onChange={(next) => setEditing({
                  ...editing,
                  draft: {
                    ...editing.draft,
                    ...(next === undefined ? { switchDepthM: undefined } : { switchDepthM: next }),
                  },
                })}
                units={units.depth}
                valueM={editing.draft.switchDepthM}
              />
              {editingModM !== undefined && <div className="bf-tank-switch-depth-actions">
                <ActionButton
                  onClick={() => setEditing({
                    ...editing,
                    draft: { ...editing.draft, switchDepthM: editingModM },
                  })}
                  quiet
                  small
                >
                  Use MOD
                </ActionButton>
              </div>}
            </>}
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
