import React from "react";

export const ICONS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  box: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  cart: "M3 4h2l2.4 11h10.2L20 7H6M9 20.2v.01M17 20.2v.01",
  layers: "M12 3 3 8l9 5 9-5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5",
  wallet:
    "M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h2",
  users:
    "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.2a3.5 3.5 0 0 1 0 6.6",
  bell: "M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 21h4",
  sparkle:
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  more: "M12 5.5v.01M12 12v.01M12 18.5v.01",
  dots: "M5 12v.01M12 12v.01M19 12v.01",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM6 11a6 6 0 0 0 12 0M12 17v4",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5l4.5 4.5L19 7",
  down: "M6 9l6 6 6-6",
  left: "M15 6l-6 6 6 6",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  phone:
    "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  auto: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18M12 3a9 9 0 0 1 0 18z",
  wifioff:
    "M2 8.8a15 15 0 0 1 4-2.4M22 8.8a15 15 0 0 0-8-3.7M5 12.5a10 10 0 0 1 3.5-2M19 12.5a10 10 0 0 0-5-2.4M8.5 16a5 5 0 0 1 7 0M12 20v.01M3 3l18 18",
  wifi: "M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20v.01",
  refresh:
    "M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5",
  logout: "M10 4H5v16h5M15 8l4 4-4 4M19 12H9",
  cal: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  send: "M4 12 20 4l-6 16-3-7z",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  alert: "M12 4 2.5 20h19zM12 10v4M12 17v.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  history:
    "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  store:
    "M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0M10 20v-5h4v5",
  scale:
    "M12 4v16M6 20h12M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z",
  print: "M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z",
  truck: "M2 6h11v10H2zM13 9h4l3 3v4h-7M6 19.2v.01M17 19.2v.01",
  list: "M8 6h12M8 12h12M8 18h12M4 6v.01M4 12v.01M4 18v.01",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.01",
  stop: "M7 7h10v10H7z",
  eye: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  eyeoff:
    "M9.88 9.88a3 3 0 1 0 4.24 4.24 M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68 M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61 M2 2l20 20",
} as const;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  n: IconName;
  s?: number;
  sw?: number;
  className?: string;
}

export function Icon({ n, s = 20, sw = 2, className = "" }: IconProps) {
  const path = ICONS[n] || "";
  const strokeWidth = n === "more" || n === "dots" ? 3.2 : sw;

  return (
    <svg
      className={`ic ${className}`}
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
