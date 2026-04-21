import type { CSSProperties } from 'react';

/**
 * SalesPage `getGlassTableSurfaceStyle` 테이블 상태 색상과 동일 (맵·탭카드 톤 일치).
 * SalesPage는 TABLEMAP 보호로 수정하지 않고 값만 여기서 유지합니다.
 */
const STATUS_BG: Record<string, string> = {
  Available: '#1abc9c',
  Occupied: '#ffa726',
  'Payment Pending': '#78909c',
  Cleaning: '#90a4ae',
  Hold: '#ef5350',
  Reserved: '#b258c4',
};

const STATUS_NEON: Record<string, string> = {
  Available: '#0fa882',
  Occupied: '#ff9100',
  'Payment Pending': '#546e7a',
  Cleaning: '#607d8b',
  Hold: '#d50000',
  Reserved: '#9c27b0',
};

const NEUMORPHIC_SHADOW_RAISED = '6px 6px 12px #b8bec7, -6px -6px 12px #ffffff';

export type BistroTabCardTableVisualStatus = 'Available' | 'Occupied' | 'Payment Pending';

/** 탭명·테이블·서버·금액 — 테이블/서버는 색상(hue)으로 구분해 한눈에 구별 */
export type BistroTabCardTextTheme = {
  title: string;
  table: string;
  server: string;
  amount: string;
};

export function getBistroTabCardTextTheme(
  status: BistroTabCardTableVisualStatus
): BistroTabCardTextTheme {
  switch (status) {
    case 'Available':
      return {
        title: '#042f28',
        table: '#064e3b',
        server: '#1e3a5f',
        amount: '#042f28',
      };
    case 'Occupied':
      return {
        title: '#3a0f06',
        table: '#7c2d12',
        server: '#1e3a8a',
        amount: '#3a0f06',
      };
    case 'Payment Pending':
      return {
        title: '#ffffff',
        table: '#b3e5fc',
        server: '#ffe082',
        amount: '#ffffff',
      };
    default:
      return {
        title: '#111827',
        table: '#0d47a1',
        server: '#b71c1c',
        amount: '#111827',
      };
  }
}

/** 탭 카드 볼록 네오 표면 (테이블 동일 그라데이션·네온 링). 글자색은 `getBistroTabCardTextTheme`로 지정 */
export function getBistroTabCardNeumorphicSurfaceStyle(
  status: BistroTabCardTableVisualStatus
): CSSProperties {
  const bg = STATUS_BG[status] || '#e0e5ec';
  const neon = STATUS_NEON[status] || '#00e676';

  return {
    background: `linear-gradient(160deg, ${bg}ee 0%, ${bg} 50%, ${bg}dd 100%)`,
    border: '1px solid rgba(255,255,255,0.3)',
    boxShadow: [
      NEUMORPHIC_SHADOW_RAISED,
      `inset 0 3px 6px rgba(255,255,255,0.45)`,
      `inset 0 -2px 5px rgba(0,0,0,0.15)`,
      `0 0 12px ${neon}55`,
    ].join(', '),
    borderRadius: 12,
  };
}
