import React, { useMemo, useState } from 'react';
import BistroTabPanel from './BistroTabPanel';
import {
  BISTRO_NEUMORPHIC_SHADOW_HOVER,
  BISTRO_NEUMORPHIC_SHADOW_PRESSED,
  computeBistroFsLayout,
  getBistroElementClass,
  getBistroElementDisplayName,
  getBistroElementStyle,
  type BistroFsElement,
} from '../../utils/bistroFsTableMapView';

type TableEl = {
  id: number;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation?: number;
  text?: string;
  fontSize?: number;
  color?: string;
  status?: string;
};

function toBistroFs(e: TableEl): BistroFsElement {
  return {
    id: String(e.id),
    type: String(e.type || ''),
    position: e.position,
    size: e.size,
    rotation: Number(e.rotation || 0),
    text: String(e.text ?? '').trim(),
    fontSize: Number(e.fontSize || 20),
    color: e.color,
    status: String(e.status || 'Available'),
    current_order_id: null,
  };
}

function restoreGlassShadow(element: BistroFsElement, target: HTMLElement) {
  const st = getBistroElementStyle(element, 1, null);
  if (typeof st.boxShadow === 'string') {
    target.style.boxShadow = st.boxShadow;
  }
}

export type BistroManagerMapPreviewProps = {
  tableElements: TableEl[];
  frameWidthPx: number;
  frameHeightPx: number;
  tableMapLeftPercent: number;
};

/**
 * Read-only Bistro layout preview for Table Map Manager — matches `/bistro` (Sales) split + glass styling.
 */
const BistroManagerMapPreview: React.FC<BistroManagerMapPreviewProps> = ({
  tableElements,
  frameWidthPx,
  frameHeightPx,
  tableMapLeftPercent,
}) => {
  const [pressedTableId, setPressedTableId] = useState<string | null>(null);
  const tableOccupiedTimes = useMemo(() => ({} as Record<string, number>), []);

  const layout = useMemo(
    () =>
      computeBistroFsLayout({
        frameWidthPx,
        frameHeightPx,
        tableMapLeftPercent,
      }),
    [frameWidthPx, frameHeightPx, tableMapLeftPercent]
  );

  const { contentHeightPx, leftWidthPx, rightWidthPx, elementScale } = layout;

  const bistroElements = useMemo(
    () => tableElements.map(toBistroFs).filter((e) => e.id),
    [tableElements]
  );

  const tableStatusById = useMemo(() => {
    const m: Record<string, string> = {};
    bistroElements.forEach((e) => {
      if (['rounded-rectangle', 'circle', 'bar', 'room'].includes(e.type)) {
        m[String(e.id)] = e.status || 'Available';
      }
    });
    return m;
  }, [bistroElements]);

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      style={{ width: `${frameWidthPx}px`, height: '100%' }}
      title={`Bistro preview scale ${Math.round(elementScale * 100)}%`}
    >
      <div className="flex flex-1 overflow-hidden" style={{ height: `${contentHeightPx}px`, width: `${frameWidthPx}px` }}>
        <div className="relative" style={{ width: `${leftWidthPx}px`, height: `${contentHeightPx}px` }}>
          <div
            className="relative border-2 border-gray-300 bg-white shadow-lg"
            style={{
              width: `${leftWidthPx}px`,
              height: `${contentHeightPx}px`,
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            {bistroElements.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-gray-500">No elements on this floor.</p>
              </div>
            ) : (
              bistroElements.map((element) => (
                <div
                  key={element.id}
                  role="presentation"
                  style={getBistroElementStyle(element, elementScale, pressedTableId)}
                  className={getBistroElementClass(element, pressedTableId)}
                  onMouseEnter={(e) => {
                    const isGlass = ['rounded-rectangle', 'bar', 'room', 'circle'].includes(element.type);
                    if (isGlass) {
                      e.currentTarget.style.boxShadow = BISTRO_NEUMORPHIC_SHADOW_HOVER;
                    }
                  }}
                  onMouseLeave={(e) => {
                    restoreGlassShadow(element, e.currentTarget);
                    setPressedTableId((prev) => (prev === String(element.id) ? null : prev));
                  }}
                  onMouseDown={(e) => {
                    const isGlass = ['rounded-rectangle', 'bar', 'room', 'circle'].includes(element.type);
                    if (isGlass) {
                      e.currentTarget.style.boxShadow = BISTRO_NEUMORPHIC_SHADOW_PRESSED;
                    }
                    setPressedTableId(String(element.id));
                  }}
                  onMouseUp={(e) => {
                    restoreGlassShadow(element, e.currentTarget);
                  }}
                  title={`${element.type} - ${element.status || 'Available'} (preview)`}
                >
                  {element.type === 'restroom' ? (
                    <img
                      src={process.env.PUBLIC_URL + '/images/restroom.png'}
                      alt="Restroom"
                      className="h-full w-full object-contain"
                      draggable={false}
                    />
                  ) : element.type === 'counter' ? (
                    <img
                      src={process.env.PUBLIC_URL + '/images/pos.png'}
                      alt="Counter"
                      className="h-full w-full object-contain"
                      draggable={false}
                    />
                  ) : (
                    (() => {
                      const raw = getBistroElementDisplayName(element, tableOccupiedTimes) || '';
                      const parts = String(raw).split('\n');
                      const firstLine = parts[0] || '';
                      const secondLine = parts[1] || '';
                      const baseFont = element.fontSize ? Number(element.fontSize) : 14;
                      const nameFontSize = Math.round(baseFont * 1.25);
                      const timeFont = Math.max(10, Math.round((baseFont / 2) * 1.6));
                      const isGlassTable =
                        element.type === 'rounded-rectangle' ||
                        element.type === 'bar' ||
                        element.type === 'room' ||
                        element.type === 'circle';
                      const glossRadius = element.type === 'circle' ? '50%' : '26px';
                      return (
                        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                          {isGlassTable ? (
                            <div
                              aria-hidden
                              style={{
                                position: 'absolute',
                                inset: 0,
                                zIndex: 0,
                                pointerEvents: 'none',
                                borderRadius: glossRadius,
                                background:
                                  'linear-gradient(155deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.12) 18%, transparent 42%), linear-gradient(210deg, transparent 55%, rgba(255,255,255,0.08) 78%, rgba(255,255,255,0.18) 100%)',
                                boxShadow:
                                  'inset 0 4px 10px rgba(255,255,255,0.35), inset 0 -3px 8px rgba(0,0,0,0.06)',
                              }}
                            />
                          ) : null}
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              zIndex: 1,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              textAlign: 'center',
                              lineHeight: 1.0,
                              transform: `rotate(${-Number(element.rotation || 0)}deg)`,
                              transformOrigin: 'center',
                            }}
                          >
                            <div style={{ fontSize: nameFontSize, fontWeight: 800 }}>{firstLine}</div>
                            {secondLine ? (
                              <div
                                style={{
                                  fontSize: timeFont,
                                  fontWeight: 700,
                                  marginTop: 2,
                                  opacity: 0.85,
                                }}
                              >
                                {secondLine}
                              </div>
                            ) : null}
                            {parts[2] ? (
                              <div
                                style={{
                                  fontSize: Math.max(9, timeFont - 2),
                                  fontWeight: 600,
                                  marginTop: 1,
                                  opacity: 0.75,
                                }}
                              >
                                {parts[2]}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div
          className="relative flex flex-col overflow-hidden border-l border-gray-300 bg-blue-50"
          style={{ width: `${rightWidthPx}px`, height: `${contentHeightPx}px`, zIndex: 10 }}
        >
          <div className="shrink-0 border-b border-indigo-200 bg-indigo-50 px-2 py-1 text-center text-[10px] font-semibold text-indigo-900">
            Tab panel (Order Setup Bistro width: {tableMapLeftPercent}% map · {100 - tableMapLeftPercent}% tabs)
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <BistroTabPanel
              orders={[]}
              tableStatusById={tableStatusById}
              loading={false}
              onRefresh={() => {}}
              onSelectOrder={() => {}}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BistroManagerMapPreview;
