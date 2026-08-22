import { Capacitor } from "@capacitor/core";
import { registerSW } from "virtual:pwa-register";

export function registerPwa(): void {
  if (Capacitor.isNativePlatform()) return;
  registerSW({ immediate: true });
}
