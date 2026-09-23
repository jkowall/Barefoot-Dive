import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Icon({ children, ...props }: IconProps & { readonly children: ReactNode }) {
  return <svg
    aria-hidden="true"
    fill="none"
    focusable="false"
    height="20"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
    viewBox="0 0 20 20"
    width="20"
    {...props}
  >{children}</svg>;
}

/** Stepped decompression profile: descent, bottom, staged ascent. */
export function PlanIcon(props: IconProps) {
  return <Icon {...props}><path d="M2.5 4.5 5 15h4l1-4h2l1-4h2l2.5-2.5" /><path d="M2.5 4.5h15" strokeOpacity=".5" /></Icon>;
}

/** Overhead environment: a cave arch with a guideline beneath it. */
export function CaveIcon(props: IconProps) {
  return <Icon {...props}><path d="M3 16V9a7 7 0 0 1 14 0v7" /><path d="M6.5 16v-5a3.5 3.5 0 0 1 7 0v5" /><path d="M2.5 16.5h15" strokeOpacity=".5" /></Icon>;
}

/** Calculator tools: a wrench. */
export function ToolsIcon(props: IconProps) {
  return <Icon {...props}><path d="M12.6 3.2a4 4 0 0 0-4.9 5L3 12.9a1.6 1.6 0 0 0 2.2 2.3l4.7-4.7a4 4 0 0 0 5-4.9l-2.2 2.2-2.1-.6-.6-2.1 2.6-2.1Z" /></Icon>;
}

/** Tank bank: a cylinder with a valve. */
export function TankIcon(props: IconProps) {
  return <Icon {...props}><path d="M8 2.5h4" /><path d="M10 2.5v2" /><rect height="12" rx="2.5" width="8" x="6" y="5" /><path d="M6 9h8" strokeOpacity=".5" /></Icon>;
}

/** Saved plans: stacked snapshots. */
export function PlansIcon(props: IconProps) {
  return <Icon {...props}><rect height="11" rx="1.5" width="11" x="3" y="6" /><path d="M6.5 3.5h9a1.5 1.5 0 0 1 1.5 1.5v9" strokeOpacity=".6" /><path d="M6 10h5M6 13h3" /></Icon>;
}

/** Settings: a gear. */
export function SettingsIcon(props: IconProps) {
  return <Icon {...props}><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></Icon>;
}
