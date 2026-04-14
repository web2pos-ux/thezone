import type { CSSProperties } from 'react';

/** 번짐(blur) 없음 — offset + 0 blur 로 경계만 구분 */
const SHARP = {
  shell: '2px 2px 0 0 #b8c0cc, -2px -2px 0 0 #ffffff',
  panel: '2px 2px 0 0 #c5ccd6, -1px -1px 0 0 #ffffff',
  insetWell: 'inset 2px 2px 0 0 #b0b6c0, inset -1px -1px 0 0 #ffffff',
  btnRound: '2px 2px 0 0 #b0b6c0, -1px -1px 0 0 #ffffff',
  tabRaised: '2px 2px 0 0 #b8bec7, -1px -1px 0 0 #ffffff',
} as const;

/** Soft neumorphic tokens (WaitingList / Reservation 계열 — 날카로운 이중선 그림자) */
export const SOFT_NEO: Record<string, CSSProperties> = {
  shell: {
    background: 'linear-gradient(145deg, #e8ecf2, #dde3ec)',
    boxShadow: SHARP.shell,
  },
  panel: {
    background: 'linear-gradient(145deg, #e8ecf2, #dde3ec)',
    boxShadow: SHARP.panel,
  },
  insetWell: {
    background: 'linear-gradient(145deg, #dce1ea, #d0d6e0)',
    boxShadow: SHARP.insetWell,
  },
  btnRound: {
    background: 'linear-gradient(145deg, #eef1f7, #dce2eb)',
    boxShadow: SHARP.btnRound,
  },
  btnPrimary: {
    background: 'linear-gradient(145deg, #3b82f6, #2563eb)',
    boxShadow: '2px 2px 0 0 rgba(29,78,216,0.55), -1px -1px 0 0 rgba(255,255,255,0.35)',
  },
  tabRaised: {
    background: 'linear-gradient(145deg, #eaeff6, #dce1e8)',
    boxShadow: SHARP.tabRaised,
  },
  btnSuccess: {
    background: 'linear-gradient(145deg, #22c55e, #16a34a)',
    boxShadow: '2px 2px 0 0 rgba(21,128,61,0.5), -1px -1px 0 0 rgba(255,255,255,0.3)',
  },
  btnWarn: {
    background: 'linear-gradient(145deg, #fb923c, #ea580c)',
    boxShadow: '2px 2px 0 0 rgba(194,65,12,0.5), -1px -1px 0 0 rgba(255,255,255,0.28)',
  },
  btnAmber: {
    background: 'linear-gradient(145deg, #fbbf24, #d97706)',
    boxShadow: '2px 2px 0 0 rgba(180,83,9,0.45), -1px -1px 0 0 rgba(255,255,255,0.35)',
  },
};

/** Order History 모달 액션 바 — 동일하게 blur 0 */
export const OH_ACTION_NEO: Record<string, CSSProperties> = {
  bar: {
    background: 'linear-gradient(145deg, #cbd5e1, #e2e8f0)',
    boxShadow: 'inset 2px 2px 0 0 rgba(100,116,139,0.22), inset -1px -1px 0 0 rgba(255,255,255,1)',
  },
  slate: {
    background: 'linear-gradient(145deg, #64748b, #475569)',
    boxShadow: '2px 2px 0 0 rgba(30,41,59,0.45), -1px -1px 0 0 rgba(255,255,255,0.22)',
  },
  red: {
    background: 'linear-gradient(145deg, #ef4444, #b91c1c)',
    boxShadow: '2px 2px 0 0 rgba(127,29,29,0.5), -1px -1px 0 0 rgba(255,255,255,0.18)',
  },
  orange: {
    background: 'linear-gradient(145deg, #fb923c, #c2410c)',
    boxShadow: '2px 2px 0 0 rgba(154,52,18,0.48), -1px -1px 0 0 rgba(255,255,255,0.2)',
  },
  blue: {
    background: 'linear-gradient(145deg, #3b82f6, #1d4ed8)',
    boxShadow: '2px 2px 0 0 rgba(29,78,216,0.5), -1px -1px 0 0 rgba(255,255,255,0.22)',
  },
  emerald: {
    background: 'linear-gradient(145deg, #10b981, #047857)',
    boxShadow: '2px 2px 0 0 rgba(6,95,70,0.48), -1px -1px 0 0 rgba(255,255,255,0.2)',
  },
  green: {
    background: 'linear-gradient(145deg, #22c55e, #166534)',
    boxShadow: '2px 2px 0 0 rgba(22,101,52,0.5), -1px -1px 0 0 rgba(255,255,255,0.2)',
  },
  disabled: {
    background: 'linear-gradient(145deg, #e2e8f0, #cbd5e1)',
    boxShadow: 'inset 2px 2px 0 0 rgba(148,163,184,0.35), inset -1px -1px 0 0 rgba(255,255,255,0.9)',
    color: '#64748b',
  },
};

/**
 * PaymentModal 본 화면 — 안쪽(inset/raised/key)은 소프트 네오 유지.
 * modalShell 바깥은 blur 반경 0(샤프 이중선)만 사용 — 딤 위로 흰 번짐이 퍼지지 않게 함.
 * Gift Card 오버레이는 기존 SOFT_NEO 유지.
 */
export const PAY_NEO_CANVAS = '#e0e5ec';

export const PAY_NEO: Record<string, CSSProperties> = {
  modalShell: {
    background: PAY_NEO_CANVAS,
    boxShadow: '4px 4px 0 0 #b8c0cc, -3px -3px 0 0 #ffffff',
    borderRadius: 16,
    border: 0,
  },
  inset: {
    background: '#e0e5ec',
    boxShadow: 'inset 5px 5px 10px #babecc, inset -5px -5px 10px #ffffff',
    borderRadius: 14,
    border: 0,
  },
  raised: {
    background: '#e0e5ec',
    boxShadow: '5px 5px 10px #babecc, -5px -5px 10px #ffffff',
    borderRadius: 12,
    border: 0,
  },
  key: {
    background: '#e0e5ec',
    boxShadow: '4px 4px 8px #c4c8d4, -4px -4px 8px #ffffff',
    borderRadius: 10,
    border: 0,
  },
  /** 숫자 패드·보조 키 — 베이스만 약간 진하게 */
  keyPad: {
    background: '#d4d9e4',
    boxShadow: '5px 5px 10px #b0b6c4, -4px -4px 9px #ffffff',
    borderRadius: 10,
    border: 0,
  },
};

/** Primary CTA on PAY canvas (Open Price Add 등) — 볼록 네오 + 블루 그라데이션 (PaymentModal Pay 톤 정렬) */
export const PAY_NEO_PRIMARY_BLUE: CSSProperties = {
  ...PAY_NEO.raised,
  background: 'linear-gradient(145deg, #3b82f6, #1d4ed8)',
  color: '#ffffff',
  boxShadow: '5px 5px 12px rgba(29, 78, 216, 0.45), -3px -3px 10px rgba(255, 255, 255, 0.25)',
};

/** Primary amber CTA (Exit → Windows 등) — 블루와 동일 네오 패턴 */
export const PAY_NEO_PRIMARY_AMBER: CSSProperties = {
  ...PAY_NEO.raised,
  background: 'linear-gradient(145deg, #fbbf24, #d97706)',
  color: '#ffffff',
  boxShadow: '5px 5px 12px rgba(180, 83, 9, 0.4), -3px -3px 10px rgba(255, 255, 255, 0.25)',
};

/** PAY_NEO.key + 바깥 흰 번짐 제거 — Cancel·보조 버튼 */
export const PAY_NEO_KEY_FLAT: CSSProperties = {
  ...PAY_NEO.key,
  boxShadow: '4px 4px 8px #c4c8d4',
};

/** PaymentModal 가운데 숫자 키패드와 동일 (PAY_NEO.key 베이스 + 진한 톤) */
export const PAY_KEYPAD_KEY: CSSProperties = {
  ...PAY_NEO.key,
  background: '#d4d9e4',
  boxShadow: '5px 5px 10px #b0b6c4, -4px -4px 9px #ffffff',
};

/**
 * 투고 / 온라인 / 딜리버리 주문 생성 모달 버튼 공통 눌림
 * (인라인 style boxShadow는 유지하고 transform·brightness로 눌림 표현 — VirtualKeyboard keyPressFx와 동일 의도)
 */
export const NEO_MODAL_BTN_PRESS =
  '[-webkit-tap-highlight-color:transparent] transition-[transform,filter] duration-100 ease-out active:translate-y-px active:scale-[0.98] active:brightness-[0.93] disabled:translate-y-0 disabled:scale-100 disabled:brightness-100';

/**
 * 프렙 +5/+10/+15 등 분 버튼 — 인라인 boxShadow를 덮어 인셋 눌림이 보이게 함 (!shadow, VirtualKeyboard keyPressFx와 동일 계열)
 */
export const NEO_PREP_TIME_BTN_PRESS =
  '[-webkit-tap-highlight-color:transparent] transition-[box-shadow,transform,filter] duration-100 ease-out active:!shadow-[inset_5px_5px_10px_#babecc,inset_-5px_-5px_10px_#ffffff] active:translate-y-px active:scale-[0.98] active:brightness-[0.93] disabled:translate-y-0 disabled:scale-100 disabled:brightness-100';

/**
 * 그라데이션/컬러 인라인 boxShadow 버튼 — 딜리버리 채널 4종, OH_ACTION_NEO 슬레이트·블루·에메랄드 등
 */
export const NEO_COLOR_BTN_PRESS =
  '[-webkit-tap-highlight-color:transparent] transition-[box-shadow,transform,filter] duration-100 ease-out active:!shadow-[inset_4px_4px_12px_rgba(0,0,0,0.48),inset_-2px_-2px_8px_rgba(255,255,255,0.14)] active:translate-y-px active:scale-[0.97] disabled:translate-y-0 disabled:scale-100 disabled:brightness-100';

/** PaymentCompleteModal 영수증 버튼과 동일한 모서리 반경 (로컬 `PCM_RX_ROUND`와 동일 값). */
export const PCM_RX_ROUND: CSSProperties = { borderRadius: 12 };

/** Reservation 모달 등 — `:active` 오목/스케일이 지연 없이 바로 보이도록 `duration-0` */
export const NEO_MODAL_BTN_PRESS_SNAP =
  '[-webkit-tap-highlight-color:transparent] transition-[transform,filter] duration-0 ease-out active:translate-y-px active:scale-[0.98] active:brightness-[0.93] disabled:translate-y-0 disabled:scale-100 disabled:brightness-100';

export const NEO_PREP_TIME_BTN_PRESS_SNAP =
  '[-webkit-tap-highlight-color:transparent] transition-[box-shadow,transform,filter] duration-0 ease-out active:!shadow-[inset_5px_5px_10px_#babecc,inset_-5px_-5px_10px_#ffffff] active:translate-y-px active:scale-[0.98] active:brightness-[0.93] disabled:translate-y-0 disabled:scale-100 disabled:brightness-100';

export const NEO_COLOR_BTN_PRESS_SNAP =
  '[-webkit-tap-highlight-color:transparent] transition-[box-shadow,transform,filter] duration-0 ease-out active:!shadow-[inset_4px_4px_12px_rgba(0,0,0,0.48),inset_-2px_-2px_8px_rgba(255,255,255,0.14)] active:translate-y-px active:scale-[0.97] disabled:translate-y-0 disabled:scale-100 disabled:brightness-100';

/**
 * 인셋 눌림만 — `active:translate-y` / `scale` 없음 (버튼이 아래로 밀려 보이지 않음).
 * 닫기 X, Void 키패드 등 고정 위치에 권장.
 */
export const NEO_PRESS_INSET_ONLY_NO_SHIFT =
  '[-webkit-tap-highlight-color:transparent] transition-[box-shadow,filter] duration-100 ease-out active:!shadow-[inset_5px_5px_10px_#babecc,inset_-5px_-5px_10px_#ffffff] active:brightness-[0.94] disabled:brightness-100';

/**
 * `NEO_PRESS_INSET_ONLY_NO_SHIFT`와 동일(이동·스케일 없음); :active 오목의 밝은 면을 흰색 대신 노란 하이라이트로.
 * 온라인/투고 카드 모달 Print Bill(`PAY_NEO_PRIMARY_AMBER`) 전용.
 */
export const NEO_PRESS_INSET_AMBER_NO_SHIFT =
  '[-webkit-tap-highlight-color:transparent] transition-[box-shadow,filter] duration-100 ease-out active:!shadow-[inset_5px_5px_10px_#babecc,inset_-5px_-5px_10px_rgba(250,204,21,0.72)] active:brightness-[0.94] disabled:brightness-100';

/** 컬러 CTA — 인셋 눌림만, 위치 이동 없음 */
export const NEO_COLOR_BTN_PRESS_NO_SHIFT =
  '[-webkit-tap-highlight-color:transparent] transition-[box-shadow,filter] duration-100 ease-out active:!shadow-[inset_4px_4px_12px_rgba(0,0,0,0.48),inset_-2px_-2px_8px_rgba(255,255,255,0.14)] disabled:brightness-100';

/** Gift Card / Sold Out 등 모달 닫기 X — `PAY_NEO.raised` + 바깥 흰 번짐 제거 */
export const MODAL_CLOSE_X_RAISED_STYLE: CSSProperties = {
  ...PAY_NEO.raised,
  boxShadow: '5px 5px 10px #babecc',
};

/**
 * `bg-slate-700` 헤더 위 닫기 X — 밝은 회색 캔버스 대신 다크톤 볼록 네오
 * (배경 #334155 대비 살짝 올라온 면 + 짙은 그림자 / 슬레이트 하이라이트)
 */
export const MODAL_CLOSE_X_ON_SLATE700_RAISED_STYLE: CSSProperties = {
  background: 'linear-gradient(145deg, #556277, #3d4d62)',
  borderRadius: 12,
  border: 0,
  boxShadow:
    '5px 5px 14px rgba(15, 23, 42, 0.58), -4px -4px 12px rgba(148, 163, 184, 0.28)',
};
