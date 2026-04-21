import type React from 'react';

/** FSR SalesPage 테이블맵과 동일한 시각(뉴모픽 글래스) — SalesPage 파일은 수정하지 않고 상수만 맞춤 */
export const BISTRO_NEUMORPHIC_SHADOW_RAISED = '6px 6px 12px #b8bec7, -6px -6px 12px #ffffff';
export const BISTRO_NEUMORPHIC_SHADOW_HOVER = '8px 8px 16px #b8bec7, -8px -8px 16px #ffffff';
export const BISTRO_NEUMORPHIC_SHADOW_PRESSED = 'inset 4px 4px 8px #b8bec7, inset -4px -4px 8px #ffffff';

export function formatBistroHeaderClockLabel(date = new Date()): string {
  const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const day = date.getDate().toString().padStart(2, '0');
  const weekday = date.toLocaleString('en-US', { weekday: 'short' });
  const dateLabel = `${month}-${day} (${weekday})`;
  const timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${dateLabel} ${timeLabel}`;
}

function getContrastColor(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128 ? '#000000' : '#FFFFFF';
}

export function getBistroGlassTableSurfaceStyle(rawStatus: string): React.CSSProperties {
  const status = rawStatus || 'Available';
  const STATUS_BG: Record<string, string> = {
    Available: '#1abc9c',
    Occupied: '#ffa726',
    'Payment Pending': '#78909c',
    Cleaning: '#90a4ae',
    Hold: '#ef5350',
    Reserved: '#b258c4',
  };
  const STATUS_TEXT: Record<string, string> = {
    Available: '#003d2e',
    Occupied: '#bf360c',
    'Payment Pending': '#ffffff',
    Cleaning: '#263238',
    Hold: '#ffffff',
    Reserved: '#4a148c',
  };
  const bg = STATUS_BG[status] || '#e0e5ec';
  const textColor = STATUS_TEXT[status] || '#4B5563';
  const STATUS_NEON: Record<string, string> = {
    Available: '#0fa882',
    Occupied: '#ff9100',
    'Payment Pending': '#546e7a',
    Cleaning: '#607d8b',
    Hold: '#d50000',
    Reserved: '#9c27b0',
  };
  const neon = STATUS_NEON[status] || '#00e676';
  return {
    background: `linear-gradient(160deg, ${bg}ee 0%, ${bg} 50%, ${bg}dd 100%)`,
    border: '1px solid rgba(255,255,255,0.3)',
    boxShadow: [
      BISTRO_NEUMORPHIC_SHADOW_RAISED,
      `inset 0 3px 6px rgba(255,255,255,0.45)`,
      `inset 0 -2px 5px rgba(0,0,0,0.15)`,
      `0 0 12px ${neon}55`,
    ].join(', '),
    color: textColor,
    textShadow: 'none',
    overflow: 'hidden',
  };
}

export type BistroFsElement = {
  id: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  text: string;
  fontSize: number;
  color?: string;
  status: string;
  current_order_id?: number | null;
};

export function apiRowToBistroFsElement(row: any): BistroFsElement | null {
  const id = String(row?.id ?? row?.element_id ?? '').trim();
  if (!id) return null;
  const pos = row.position || {};
  const sz = row.size || {};
  const x = Number(pos.x ?? row.x_pos ?? 0);
  const y = Number(pos.y ?? row.y_pos ?? 0);
  const width = Math.max(8, Number(sz.width ?? row.width ?? 80));
  const height = Math.max(8, Number(sz.height ?? row.height ?? 60));
  const cur = row.current_order_id;
  const current_order_id =
    cur != null && String(cur) !== '' && Number.isFinite(Number(cur)) ? Number(cur) : null;
  return {
    id,
    type: String(row.type || ''),
    position: { x, y },
    size: { width, height },
    rotation: Number(row.rotation || 0),
    text: String(row.text ?? row.name ?? '').trim(),
    fontSize: Number(row.fontSize || 20),
    color: row.color,
    status: String(row.status || 'Available'),
    current_order_id,
  };
}

export function computeBistroFsLayout(args: {
  frameWidthPx: number;
  frameHeightPx: number;
  /** 테이블맵 영역 너비 % (나머지가 탭 패널) */
  tableMapLeftPercent: number;
}): {
  headerHeightPx: number;
  footerHeightPx: number;
  contentHeightPx: number;
  leftWidthPx: number;
  rightWidthPx: number;
  elementScale: number;
} {
  const { frameWidthPx, frameHeightPx, tableMapLeftPercent } = args;
  const headerHeightPx = 56;
  const isWidescreen = frameWidthPx / frameHeightPx >= 1.5;
  const footerHeightPx = isWidescreen ? 91 : 70;
  const contentHeightPx = Math.max(0, frameHeightPx - headerHeightPx - footerHeightPx);
  const togoPanelLeftPct = Math.max(0, Math.min(100, tableMapLeftPercent));
  const leftWidthPx = Math.round(frameWidthPx * (togoPanelLeftPct / 100));
  const rightWidthPx = Math.max(0, frameWidthPx - leftWidthPx);
  const boMapHeight = Math.max(0, frameHeightPx - 56 - 70);
  const boMapWidth = frameWidthPx * 0.75;
  const elementScaleX = leftWidthPx / boMapWidth;
  const elementScaleY = contentHeightPx / boMapHeight;
  const elementScale = Math.min(elementScaleX, elementScaleY);
  return {
    headerHeightPx,
    footerHeightPx,
    contentHeightPx,
    leftWidthPx,
    rightWidthPx,
    elementScale,
  };
}

export function getBistroElementDisplayName(
  element: BistroFsElement,
  tableOccupiedTimes: Record<string, number>
): string {
  switch (element.type) {
    case 'rounded-rectangle':
    case 'circle':
    case 'bar':
    case 'room': {
      const raw = element.text ? String(element.text).trim() : '';
      const prefix = element.type === 'bar' ? 'B' : element.type === 'room' ? 'R' : 'T';
      let displayName = raw || `${prefix}${element.id}`;
      if (
        (element.status === 'Occupied' || element.status === 'Payment Pending') &&
        tableOccupiedTimes[String(element.id)]
      ) {
        const now = Date.now();
        const elapsed = Math.floor((now - tableOccupiedTimes[String(element.id)]) / 1000 / 60);
        const hours = Math.floor(elapsed / 60);
        const minutes = elapsed % 60;
        displayName += `\n${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      }
      return displayName;
    }
    case 'entrance':
      return 'Entrance';
    case 'counter':
      return 'Counter';
    case 'washroom':
      return 'WashRoom';
    case 'restroom':
      return 'Restroom';
    case 'cook-area':
      return 'Cook';
    case 'divider':
    case 'wall':
      return '';
    case 'other':
      return element.text ? String(element.text).trim() : '';
    case 'floor-label':
      return element.text || 'Floor';
    default:
      return 'Element';
  }
}

export function getBistroElementClass(element: BistroFsElement, pressedTableId: string | null): string {
  const glassTableTypes = ['rounded-rectangle', 'bar', 'room', 'circle'];
  const baseStyle = ['restroom', 'counter'].includes(element.type)
    ? ''
    : glassTableTypes.includes(element.type)
      ? 'hover:-translate-y-px transition-all duration-[250ms]'
      : 'shadow-[inset_3px_3px_8px_rgba(255,255,255,0.3),inset_-3px_-3px_8px_rgba(0,0,0,0.3),0_2px_4px_rgba(0,0,0,0.2)] hover:shadow-[inset_-3px_-3px_8px_rgba(255,255,255,0.3),inset_3px_3px_8px_rgba(0,0,0,0.3),0_2px_4px_rgba(0,0,0,0.2)] hover:scale-105 active:scale-95 active:shadow-[inset_4px_4px_10px_rgba(255,255,255,0.2),inset_-4px_-4px_10px_rgba(0,0,0,0.4),0_1px_2px_rgba(0,0,0,0.3)] transition-all duration-300';

  let shapeClass = '';
  switch (element.type) {
    case 'rounded-rectangle':
    case 'bar':
    case 'room':
      shapeClass = 'rounded-[26px]';
      break;
    case 'circle':
      shapeClass = 'rounded-full';
      break;
    case 'entrance':
    case 'wall':
    case 'cook-area':
    case 'other':
      shapeClass = 'rounded-xl';
      break;
    case 'divider':
      shapeClass = 'rounded-full';
      break;
    case 'floor-label':
      shapeClass = 'rounded-lg';
      break;
    default:
      shapeClass = 'rounded-xl';
  }
  const isPressed = pressedTableId && String(pressedTableId) === String(element.id);
  const pressedClass = isPressed ? 'bg-red-500 text-white transition-colors duration-200' : '';
  return `${shapeClass} ${baseStyle} ${pressedClass}`.trim();
}

export function getBistroElementStyle(
  element: BistroFsElement,
  elementScale: number,
  pressedTableId: string | null
): React.CSSProperties {
  const isPressed = pressedTableId && String(pressedTableId) === String(element.id);
  const status = element.status || 'Available';
  const isClickable =
    element.type === 'rounded-rectangle' ||
    element.type === 'circle' ||
    element.type === 'bar' ||
    element.type === 'room';
  const rotationTransform = `rotate(${element.rotation}deg)`;

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${element.position.x * elementScale}px`,
    top: `${element.position.y * elementScale}px`,
    width: `${element.size.width * elementScale}px`,
    height: `${element.size.height * elementScale}px`,
    transform: rotationTransform,
    fontSize: `${Math.max(8, element.fontSize * elementScale)}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: isClickable ? 'pointer' : 'default',
    userSelect: 'none',
    border: '2px solid transparent',
    transition: 'all 0.2s ease',
  };

  const applyPressedHighlight = (style: React.CSSProperties): React.CSSProperties => {
    if (!(isClickable && isPressed)) return style;
    return { ...style, boxShadow: BISTRO_NEUMORPHIC_SHADOW_PRESSED };
  };

  switch (element.type) {
    case 'rounded-rectangle':
    case 'bar':
    case 'room': {
      const glass = getBistroGlassTableSurfaceStyle(status);
      const holdBorder = status === 'Hold';
      return applyPressedHighlight({
        ...baseStyle,
        ...glass,
        borderRadius: '26px',
        ...(holdBorder ? { border: '6px solid rgba(185, 28, 28, 0.55)' } : {}),
        fontWeight: 'bold',
      });
    }
    case 'circle': {
      const glass = getBistroGlassTableSurfaceStyle(status);
      const holdBorder = status === 'Hold';
      return applyPressedHighlight({
        ...baseStyle,
        ...glass,
        borderRadius: '50%',
        ...(holdBorder ? { border: '6px solid rgba(185, 28, 28, 0.55)' } : {}),
        fontWeight: 'bold',
      });
    }
    case 'entrance':
      return {
        ...baseStyle,
        backgroundColor: element.status === 'Hold' ? '#EAB308' : element.color || '#3B82F6',
        color: 'white',
        fontWeight: 'bold',
        borderColor: element.status === 'Hold' ? '#F97316' : undefined,
        borderWidth: element.status === 'Hold' ? '6px' : undefined,
      };
    case 'counter':
      return {
        ...baseStyle,
        backgroundColor: 'transparent',
        borderRadius: '4px',
        color: 'inherit',
      };
    case 'restroom':
      return {
        ...baseStyle,
        backgroundColor: 'transparent',
        color: 'inherit',
      };
    case 'divider':
      return {
        ...baseStyle,
        backgroundColor: element.status === 'Hold' ? '#EAB308' : element.color || '#3B82F6',
        color: getContrastColor(element.color || '#3B82F6'),
        borderColor: element.status === 'Hold' ? '#F97316' : undefined,
        borderWidth: element.status === 'Hold' ? '6px' : undefined,
      };
    case 'wall':
      return {
        ...baseStyle,
        backgroundColor: element.status === 'Hold' ? '#EAB308' : element.color || '#3B82F6',
        color: getContrastColor(element.color || '#3B82F6'),
        borderColor: element.status === 'Hold' ? '#F97316' : undefined,
        borderWidth: element.status === 'Hold' ? '6px' : undefined,
      };
    case 'cook-area':
      return {
        ...baseStyle,
        backgroundColor: element.status === 'Hold' ? '#EAB308' : element.color || '#3B82F6',
        color: getContrastColor(element.color || '#3B82F6'),
        fontWeight: 'bold',
        borderColor: element.status === 'Hold' ? '#F97316' : undefined,
        borderWidth: element.status === 'Hold' ? '6px' : undefined,
      };
    default:
      return {
        ...baseStyle,
        backgroundColor: element.status === 'Hold' ? '#EAB308' : element.color || '#3B82F6',
        color: getContrastColor(element.color || '#3B82F6'),
        borderColor: element.status === 'Hold' ? '#F97316' : undefined,
        borderWidth: element.status === 'Hold' ? '6px' : undefined,
      };
  }
}
