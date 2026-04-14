import React from 'react';

/**
 * 투고 패널(Order List · Pickup 모드)의 Togo / Online / Delivery 채널 필터 버튼
 *
 * 뉴모픽 소프트 UI — 배경과 동색, 듀얼 섀도(좌상 하이라이트 + 우하 어두운 그림자),
 * 테두리 없음, 스무스 라운드. 헤더가 `bg-slate-700` 위에 놓임.
 */
export type PickupChannelOrderListKey = 'togo' | 'online' | 'delivery';

const LABEL: Record<PickupChannelOrderListKey, string> = {
  togo: 'Togo',
  online: 'Online',
  delivery: 'Delivery',
};

/* ── 채널별 선택 시 색상 ── */
const ACTIVE_TEXT: Record<PickupChannelOrderListKey, string> = {
  togo: '#1e4035',
  online: '#1e3a5f',
  delivery: '#7f1d1d',
};

const ACTIVE_RING: Record<PickupChannelOrderListKey, string> = {
  togo: 'rgba(110,231,183,0.80)',
  online: 'rgba(147,197,253,0.80)',
  delivery: 'rgba(252,165,165,0.80)',
};

/* ── 뉴모픽 색상 (bg-slate-700 ≈ #334155 위) ── */
const BG = '#3d4f63';

/* 번짐 없음: blur 0, 오프셋 선만 */
const SHADOW_RAISED =
  '2px 2px 0 0 rgba(0,0,0,0.35), -1px -1px 0 0 rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.12)';

const SHADOW_HOVER =
  '3px 3px 0 0 rgba(0,0,0,0.38), -1px -1px 0 0 rgba(255,255,255,0.1), inset 0 1px 0 rgba(255,255,255,0.14)';

const SHADOW_PRESSED =
  'inset 2px 2px 0 rgba(0,0,0,0.32), inset -1px -1px 0 rgba(255,255,255,0.06)';

const baseStyle: React.CSSProperties = {
  position: 'relative',
  minHeight: 35,
  minWidth: 76,
  paddingLeft: 16,
  paddingRight: 16,
  borderRadius: 9999,
  border: 'none',
  background: BG,
  color: 'rgba(255,255,255,0.78)',
  fontWeight: 600,
  fontSize: '0.875rem',
  letterSpacing: '0.02em',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: SHADOW_RAISED,
  transition: 'all 250ms cubic-bezier(0.4, 0, 0.2, 1)',
  outline: 'none',
};

export interface PickupChannelGlassButtonProps {
  channel: PickupChannelOrderListKey;
  active: boolean;
  onClick: () => void;
}

export const PickupChannelGlassButton: React.FC<PickupChannelGlassButtonProps> = ({
  channel,
  active,
  onClick,
}) => {
  const activeShadow = `0 0 0 2px ${ACTIVE_RING[channel]}`;

  const activeHoverShadow = `0 0 0 2px ${ACTIVE_RING[channel]}, 1px 1px 0 0 rgba(0,0,0,0.08)`;

  const style: React.CSSProperties = {
    ...baseStyle,
    boxShadow: active ? activeShadow : SHADOW_RAISED,
    background: active ? '#ffffff' : BG,
    color: active ? ACTIVE_TEXT[channel] : 'rgba(255,255,255,0.78)',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={style}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = active ? activeHoverShadow : SHADOW_HOVER;
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = active ? activeShadow : SHADOW_RAISED;
        e.currentTarget.style.transform = 'translateY(0)';
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.boxShadow = SHADOW_PRESSED;
        e.currentTarget.style.transform = 'translateY(0) scale(0.97)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.boxShadow = active ? activeShadow : SHADOW_RAISED;
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
    >
      {LABEL[channel]}
    </button>
  );
};
