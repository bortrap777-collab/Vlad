import type { CSSProperties } from 'react';

/** Набор линейных иконок Ws (24×24, обводка currentColor). */
const P: Record<string, string> = {
  video: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h8A2.5 2.5 0 0 1 16 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-8A2.5 2.5 0 0 1 3 16.5zM16 10l5-3v10l-5-3',
  photo: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5zM4 16l4.5-4.5 4 4 2.5-2.5L20 18M15.5 9.5h.01',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  folder: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2.2h7.4A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z',
  gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7.6 7.6 0 0 1-1.9 1.1l-.3 2h-3.6l-.3-2a7.6 7.6 0 0 1-1.9-1.1l-1.9.7-1.8-3.1 1.6-1.2a7.4 7.4 0 0 1 0-3l-1.6-1.2 1.8-3.1 1.9.7a7.6 7.6 0 0 1 1.9-1.1l.3-2h3.6l.3 2a7.6 7.6 0 0 1 1.9 1.1l1.9-.7 1.8 3.1-1.6 1.2a7.4 7.4 0 0 1 0 3z',
  chevronRight: 'M9.5 5.5L16 12l-6.5 6.5',
  chevronLeft: 'M14.5 5.5L8 12l6.5 6.5',
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8 5v14M16 5v14',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z',
  eyeOff: 'M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.7 3.4M6.6 6.7A15.6 15.6 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9.3 9.3 0 0 0 4.4-1.1M9.9 9.9a2.8 2.8 0 0 0 4 4',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  copy: 'M8 8h11v11H8zM5 16V5h11',
  flip: 'M12 3v18M9 7L3 17h6zM15 7l6 10h-6z',
  merge: 'M4 5h7v7H4zM13 12h7v7h-7zM11 8.5h4.5V12',
  unmerge: 'M4 4h7v7H4zM13 13h7v7h-7z',
  brush: 'M14.5 4.5l5 5L11 18l-5-5zM6 13l-2.5 6.5L10 17',
  eraser: 'M8.5 19.5h11M4.6 14.6l9.2-9.2a2 2 0 0 1 2.8 0l2.5 2.5a2 2 0 0 1 0 2.8l-8.7 8.8H8.5l-3.9-3.9a.7.7 0 0 1 0-1zM9 10.2l5.5 5.5',
  target: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  speed: 'M4.5 16.5a8 8 0 1 1 15 0M12 13.5l4-5M12 13.5a1.2 1.2 0 1 0 .01 0',
  scissors: 'M8.5 8.5a2.5 2.5 0 1 1-3.5-3.5 2.5 2.5 0 0 1 3.5 3.5zm0 0L20 20M8.5 15.5a2.5 2.5 0 1 0-3.5 3.5 2.5 2.5 0 0 0 3.5-3.5zm0 0L20 4',
  music: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  text: 'M5 6V4.5h14V6M12 4.5v15M9 19.5h6',
  filters: 'M12 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM8.2 20.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM15.8 20.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z',
  crop: 'M6 2.5V18h15.5M2.5 6H18v15.5',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  cutout: 'M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 18c.8-2.3 2.7-3.5 5-3.5s4.2 1.2 5 3.5',
  rotate: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4',
  image: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5zM4 16l4.5-4.5L14 17M14 13l2-2 4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M5.5 7l1 12.5A1.5 1.5 0 0 0 8 21h8a1.5 1.5 0 0 0 1.5-1.5l1-12.5M9 7V4.5h6V7',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  quality: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 15V9l2.5 3L13 9v6M16 9v6',
  more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  download: 'M12 4v12M7 11l5 5 5-5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15',
  upload: 'M12 16V4M7 9l5-5 5 5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15',
  wand: 'M4 20L15 9M13 7l2-2 4 4-2 2zM18 3v2M21 6h-2M6 4v2M7 5H5M19 15v2M20 16h-2',
  captions: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5zM7.5 12.5h4M13.5 12.5h3M7.5 15.5h2M11.5 15.5h5',
  enhance: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  effects: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  close: 'M6 6l12 12M18 6L6 18',
  reset: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z',
  transition: 'M3.5 5.5l8.5 6.5-8.5 6.5zM20.5 5.5L12 12l8.5 6.5z',
  auto: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18',
  shield: 'M12 3l7.5 3v5.5c0 4.5-3.2 8.3-7.5 9.5-4.3-1.2-7.5-5-7.5-9.5V6z',
};

interface Props {
  name: keyof typeof P | string;
  size?: number;
  stroke?: number;
  fill?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 24, stroke = 1.9, fill = false, className, style }: Props) {
  const d = P[name] ?? P.info;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

/** Логотип W с фирменным градиентом. */
export function LogoMark({ size = 34 }: { size?: number }) {
  // «W» и маленькая «s» — знак Ws
  return (
    <svg width={size * 1.25} height={size * 0.75} viewBox="80 140 520 260" aria-hidden="true">
      <defs>
        <linearGradient id="ws-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--logo-a)" />
          <stop offset="1" stopColor="var(--logo-b)" />
        </linearGradient>
      </defs>
      <path d="M96 150h70l46 170 44-150h56l44 150 46-170h70l-84 236h-62l-42-140-42 140h-62z" fill="url(#ws-logo-g)" />
      <path
        d="M436 300c-8-14-24-20-40-20-20 0-34 10-34 24 0 30 76 16 76 48 0 16-16 28-40 28-18 0-34-8-42-22"
        transform="translate(140 10)"
        fill="none"
        stroke="var(--logo-b)"
        strokeWidth={28}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
