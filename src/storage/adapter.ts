import type { Clock, IdGenerator, StorageLike, StorageOptions } from "./types";

export const defaultClock: Clock = () => new Date().toISOString();
export const defaultIdGenerator: IdGenerator = (kind) => {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${kind}-${random}`;
};
export function browserStorage(): StorageLike {
  if (typeof window === "undefined" || !window.localStorage) throw new Error("localStorage is unavailable in this runtime.");
  return window.localStorage;
}
export function storageOptions(options?: Partial<StorageOptions>): StorageOptions {
  return { storage: options?.storage ?? browserStorage(), clock: options?.clock ?? defaultClock, idGenerator: options?.idGenerator ?? defaultIdGenerator };
}
