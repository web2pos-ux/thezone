import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/constants';
import BistroContainerModal from '../components/bistro/BistroContainerModal';
import BistroTabPanel from '../components/bistro/BistroTabPanel';
import {
  filterOrdersForBistroPanel,
  filterOrdersForContainer,
} from '../utils/bistroOrderHelpers';
import { fetchOrdersForBistroSession } from '../utils/bistroSessionOrders';
import { syncBistroTableMapFromOrders } from '../utils/bistroTableMapSync';
import {
  loadServerAssignment,
  POS_TABLE_MAP_SERVER_SESSION_ID,
} from '../utils/serverAssignmentStorage';
import { useNetworkSyncStatus } from '../contexts/NetworkSyncStatusContext';
import {
  TABLE_MAP_TOGO_PANEL_SPLIT_CHANGED_EVENT,
  TABLE_MAP_BISTRO_PANEL_SPLIT_KEY,
  readBistroTableMapLeftPercentFromStorage,
} from '../utils/tableMapTogoPanelSplit';
import {
  apiRowToBistroFsElement,
  BISTRO_NEUMORPHIC_SHADOW_HOVER,
  BISTRO_NEUMORPHIC_SHADOW_PRESSED,
  BISTRO_NEUMORPHIC_SHADOW_RAISED,
  computeBistroFsLayout,
  formatBistroHeaderClockLabel,
  getBistroElementClass,
  getBistroElementDisplayName,
  getBistroElementStyle,
  type BistroFsElement,
} from '../utils/bistroFsTableMapView';

const BISTRO_FLOOR_STORAGE_KEY = 'bistroMapFloor';

function readDefaultFloors(): string[] {
  try {
    const raw = localStorage.getItem('tableMapFloorList');
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p) && p.length) return p.map(String);
    }
  } catch {
    /* ignore */
  }
  return ['1F', '2F', '3F', 'Patio'];
}

function isBistroTableClickable(el: BistroFsElement): boolean {
  return (
    el.type === 'rounded-rectangle' ||
    el.type === 'circle' ||
    el.type === 'bar' ||
    el.type === 'room'
  );
}

/**
 * FSR SalesPage와 동일한 고정 프레임·테이블맵 시각(글래스/뉴모픽).
 * 우측만 투고 패널 대신 탭 패널. SalesPage.tsx 는 수정하지 않음.
 */
const BistroSalesPage: React.FC = () => {
  const navigate = useNavigate();
  const networkSync = useNetworkSyncStatus();
  const floors = useMemo(() => readDefaultFloors(), []);

  const [floor, setFloor] = useState(() => {
    try {
      const s = localStorage.getItem(BISTRO_FLOOR_STORAGE_KEY);
      if (s && readDefaultFloors().includes(s)) return s;
    } catch {
      /* ignore */
    }
    return readDefaultFloors()[0] || '1F';
  });

  const [bistroTableMapLeftPct, setBistroTableMapLeftPct] = useState<number>(() =>
    readBistroTableMapLeftPercentFromStorage()
  );
  const [screenSize, setScreenSize] = useState({ width: '1024', height: '768', scale: 1 });
  const [actualScreenSize, setActualScreenSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  });
  const [scaleFactor, setScaleFactor] = useState(1);

  const [tableElements, setTableElements] = useState<BistroFsElement[]>([]);
  const [tableOccupiedTimes, setTableOccupiedTimes] = useState<Record<string, number>>({});
  const [pressedTableId, setPressedTableId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => formatBistroHeaderClockLabel(new Date()));

  const [orders, setOrders] = useState<any[]>([]);
  const [loadingMap, setLoadingMap] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalContainerId, setModalContainerId] = useState('');
  const [modalTitle, setModalTitle] = useState('');

  const frameWidthPx = parseInt(screenSize.width, 10) || 1024;
  const frameHeightPx = parseInt(screenSize.height, 10) || 768;

  const layout = useMemo(
    () =>
      computeBistroFsLayout({
        frameWidthPx,
        frameHeightPx,
        tableMapLeftPercent: bistroTableMapLeftPct,
      }),
    [frameWidthPx, frameHeightPx, bistroTableMapLeftPct]
  );

  const { contentHeightPx, leftWidthPx, rightWidthPx, elementScale, footerHeightPx } = layout;

  const elementIdSet = useMemo(() => {
    const set = new Set<string>();
    tableElements.forEach((e) => {
      if (e.id) set.add(e.id);
    });
    return set;
  }, [tableElements]);

  const tableStatusById = useMemo(() => {
    const m: Record<string, string> = {};
    tableElements.forEach((e) => {
      if (e.id) m[e.id] = e.status;
    });
    return m;
  }, [tableElements]);

  const panelOrders = useMemo(
    () => filterOrdersForBistroPanel(orders, elementIdSet),
    [orders, elementIdSet]
  );

  const modalOrders = useMemo(
    () => filterOrdersForContainer(orders, modalContainerId),
    [orders, modalContainerId]
  );

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(formatBistroHeaderClockLabel(new Date())), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onResize = () =>
      setActualScreenSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const boWidth = frameWidthPx;
    const boHeight = frameHeightPx;
    const scaleX = actualScreenSize.width / boWidth;
    const scaleY = actualScreenSize.height / boHeight;
    const calculatedScale = Math.max(0.5, Math.min(2.0, Math.min(scaleX, scaleY)));
    setScaleFactor(calculatedScale);
  }, [frameWidthPx, frameHeightPx, actualScreenSize]);

  useEffect(() => {
    const onCustom = () => setBistroTableMapLeftPct(readBistroTableMapLeftPercentFromStorage());
    const onStorage = (e: StorageEvent) => {
      if (e.key === TABLE_MAP_BISTRO_PANEL_SPLIT_KEY) {
        setBistroTableMapLeftPct(readBistroTableMapLeftPercentFromStorage());
      }
    };
    window.addEventListener(TABLE_MAP_TOGO_PANEL_SPLIT_CHANGED_EVENT, onCustom as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(TABLE_MAP_TOGO_PANEL_SPLIT_CHANGED_EVENT, onCustom as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const loadMap = useCallback(async () => {
    setLoadingMap(true);
    try {
      const apiFloor = floor;
      const elementsResponse = await fetch(
        `${API_URL}/table-map/elements?floor=${encodeURIComponent(apiFloor)}`
      );
      if (!elementsResponse.ok) throw new Error('맵 로드 실패');
      const data = await elementsResponse.json();
      const rows = Array.isArray(data) ? data : [];
      const mapped = rows
        .map(apiRowToBistroFsElement)
        .filter((e): e is BistroFsElement => e != null);

      setTableElements(mapped);

      setTableOccupiedTimes((prev) => {
        const next = { ...prev };
        let changed = false;
        mapped.forEach((el) => {
          if (
            (el.status === 'Occupied' || el.status === 'Payment Pending') &&
            el.current_order_id != null
          ) {
            const key = String(el.id);
            if (!next[key]) {
              try {
                const raw = localStorage.getItem(`occupiedTimes_${apiFloor}`);
                const o = raw ? JSON.parse(raw) : {};
                next[key] = o[key] || Date.now();
              } catch {
                next[key] = Date.now();
              }
              changed = true;
            }
          }
        });
        if (changed) {
          try {
            localStorage.setItem(`occupiedTimes_${apiFloor}`, JSON.stringify(next));
          } catch {
            /* ignore */
          }
        }
        return changed ? next : prev;
      });

      const screenResponse = await fetch(
        `${API_URL}/table-map/screen-size?floor=${encodeURIComponent(apiFloor)}&_ts=${Date.now()}`,
        { cache: 'no-store' as RequestCache }
      );
      if (screenResponse.ok) {
        const screen = await screenResponse.json();
        setScreenSize({
          width: String(screen.width),
          height: String(screen.height),
          scale: screen.scale || 1,
        });
      } else {
        setScreenSize({ width: '1024', height: '768', scale: 1 });
      }
    } catch (e) {
      console.warn('[Bistro] map load', e);
      setTableElements([]);
    } finally {
      setLoadingMap(false);
    }
  }, [floor]);

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const list = await fetchOrdersForBistroSession();
      setOrders(list);
    } catch (e) {
      console.warn('[Bistro] orders load', e);
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  useEffect(() => {
    void loadMap();
  }, [loadMap]);

  useEffect(() => {
    void loadOrders();
    const t = window.setInterval(() => void loadOrders(), 12000);
    return () => window.clearInterval(t);
  }, [loadOrders]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void loadMap();
        void loadOrders();
      }
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [loadMap, loadOrders]);

  useEffect(() => {
    if (!tableElements.length) return;
    let cancelled = false;
    (async () => {
      try {
        const syncPayload = tableElements.map((e) => ({
          id: e.id,
          status: e.status,
          current_order_id: e.current_order_id ?? null,
        }));
        const changed = await syncBistroTableMapFromOrders(syncPayload, orders);
        if (!cancelled && changed) void loadMap();
      } catch (e) {
        console.warn('[Bistro] table map sync', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orders, tableElements, loadMap]);

  useEffect(() => {
    try {
      localStorage.setItem(BISTRO_FLOOR_STORAGE_KEY, floor);
    } catch {
      /* ignore */
    }
  }, [floor]);

  const openContainerModal = (id: string, title: string) => {
    setModalContainerId(id);
    setModalTitle(title);
    setModalOpen(true);
  };

  const handleTableElementActivate = (element: BistroFsElement) => {
    if (!isBistroTableClickable(element)) return;
    const raw = getBistroElementDisplayName(element, tableOccupiedTimes);
    const firstLine = String(raw).split('\n')[0] || element.text || element.id;
    openContainerModal(element.id, firstLine);
  };

  const goOrder = (orderId: number, tableId: string) => {
    let menuId: number | null = null;
    let menuName = '';
    try {
      const raw = localStorage.getItem('foh_default_menu');
      if (raw) {
        const p = JSON.parse(raw);
        if (p?.menuId != null && Number.isFinite(Number(p.menuId))) {
          menuId = Number(p.menuId);
        }
        menuName = String(p?.menuName || '');
      }
    } catch {
      /* ignore */
    }
    const sess = loadServerAssignment('session', POS_TABLE_MAP_SERVER_SESSION_ID);
    const sid = sess?.serverId != null ? String(sess.serverId) : '';
    const sname = sess?.serverName != null ? String(sess.serverName).trim() : '';
    navigate('/sales/order', {
      state: {
        orderType: 'POS',
        menuId,
        menuName,
        tableId,
        orderId: String(orderId),
        loadExisting: true,
        fromBistro: true,
        floor,
        ...(sid && sname ? { serverId: sid, serverName: sname } : {}),
      },
    });
  };

  const handleExit = () => {
    if (window.confirm('Bistro 화면을 나가시겠습니까?')) {
      navigate('/intro');
    }
  };

  const restoreGlassShadow = (element: BistroFsElement, target: HTMLElement) => {
    const isGlass = ['rounded-rectangle', 'bar', 'room', 'circle'].includes(element.type);
    if (!isGlass) return;
    const st = getBistroElementStyle(element, elementScale, null);
    if (st.boxShadow) target.style.boxShadow = String(st.boxShadow);
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="flex items-start justify-center pb-0">
        <div
            className="relative"
            style={{
              width: `${Math.round(frameWidthPx * scaleFactor)}px`,
              height: `${Math.round(frameHeightPx * scaleFactor)}px`,
            }}
          >
            <div
              style={{
                width: `${frameWidthPx}px`,
                height: `${frameHeightPx}px`,
                transform: `scale(${scaleFactor})`,
                transformOrigin: 'top left',
              }}
              className="relative flex flex-col bg-gray-100"
            >
              <div className="grid h-14 grid-cols-3 items-center border-b-2 border-blue-300 bg-gradient-to-b from-blue-100 to-blue-50 px-4 shadow-lg">
                <div className="flex h-3/4 min-w-0 items-center space-x-2">
                  <span className="text-xs font-bold text-indigo-900">Bistro</span>
                  {floors.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`h-10 rounded-lg px-4 py-2 text-sm font-semibold ${
                        floor === f
                          ? 'border border-gray-200 bg-indigo-500 text-white'
                          : 'border border-gray-200 bg-white text-gray-700 hover:bg-indigo-50 hover:text-indigo-600'
                      }`}
                      onClick={() => setFloor(f)}
                    >
                      {f}
                    </button>
                  ))}
                  {loadingMap ? (
                    <span className="text-[10px] text-gray-500">맵…</span>
                  ) : null}
                </div>
                <div className="flex min-w-0 items-center justify-center gap-2">
                  {networkSync.showAlert && !networkSync.okFlash ? (
                    <div
                      className={`pointer-events-auto max-w-[min(40vw,12rem)] shrink-0 rounded-md border px-2 py-0.5 text-left text-[10px] font-medium leading-snug text-white shadow-sm ${
                        networkSync.disconnectedUi
                          ? 'border-amber-800/60 bg-amber-950/92'
                          : networkSync.dlq > 0
                            ? 'border-rose-800/60 bg-rose-950/92'
                            : networkSync.syncActive
                              ? 'border-sky-700/50 bg-sky-950/92'
                              : 'border-slate-700/50 bg-slate-950/90'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0">
                          <div className="font-semibold">{networkSync.title}</div>
                          {networkSync.detail ? (
                            <div className="text-[9px] font-normal leading-tight opacity-85">
                              {networkSync.detail}
                            </div>
                          ) : null}
                        </div>
                        {networkSync.dlq > 0 && networkSync.onOpenDlq ? (
                          <button
                            type="button"
                            className="shrink-0 text-[9px] text-white/90 underline underline-offset-2 hover:text-white"
                            onClick={networkSync.onOpenDlq}
                          >
                            Details
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <span className="truncate text-lg font-bold tracking-wide text-gray-700">
                    {currentTime}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    className="flex h-[35px] items-center justify-center px-3 text-sm font-bold transition-all duration-150"
                    style={{
                      borderRadius: '10px',
                      border: 'none',
                      background: '#e0e5ec',
                      boxShadow: '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff',
                      color: '#6B7280',
                      cursor: 'pointer',
                    }}
                    onClick={handleExit}
                    title="Exit"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow =
                        '6px 6px 12px #b8bec7, -6px -6px 12px #ffffff';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow =
                        '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff';
                    }}
                    onMouseDown={(e) => {
                      e.currentTarget.style.boxShadow =
                        'inset 3px 3px 6px #b8bec7, inset -3px -3px 6px #ffffff';
                    }}
                    onMouseUp={(e) => {
                      e.currentTarget.style.boxShadow =
                        '4px 4px 8px #b8bec7, -4px -4px 8px #ffffff';
                    }}
                  >
                    EXIT
                  </button>
                </div>
              </div>

              <div
                className="flex flex-1"
                style={{ height: `${contentHeightPx}px`, width: `${frameWidthPx}px` }}
              >
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
                    {loadingMap ? (
                      <div className="flex h-full items-center justify-center">
                        <div className="text-center text-sm text-gray-600">데이터 로딩 중…</div>
                      </div>
                    ) : tableElements.length === 0 ? (
                      <div className="flex h-full items-center justify-center">
                        <p className="text-sm text-gray-500">이 층에 맵 요소가 없습니다.</p>
                      </div>
                    ) : (
                      tableElements.map((element) => (
                        <div
                          key={element.id}
                          role="presentation"
                          style={getBistroElementStyle(element, elementScale, pressedTableId)}
                          className={getBistroElementClass(element, pressedTableId)}
                          onMouseEnter={(e) => {
                            const isGlass = ['rounded-rectangle', 'bar', 'room', 'circle'].includes(
                              element.type
                            );
                            if (isGlass) {
                              e.currentTarget.style.boxShadow = BISTRO_NEUMORPHIC_SHADOW_HOVER;
                            }
                          }}
                          onMouseLeave={(e) => {
                            restoreGlassShadow(element, e.currentTarget);
                            setPressedTableId((prev) => (prev === String(element.id) ? null : prev));
                          }}
                          onMouseDown={(e) => {
                            const isGlass = ['rounded-rectangle', 'bar', 'room', 'circle'].includes(
                              element.type
                            );
                            if (isGlass) {
                              e.currentTarget.style.boxShadow = BISTRO_NEUMORPHIC_SHADOW_PRESSED;
                            }
                            setPressedTableId(String(element.id));
                          }}
                          onMouseUp={(e) => {
                            restoreGlassShadow(element, e.currentTarget);
                            handleTableElementActivate(element);
                          }}
                          onTouchStart={() => setPressedTableId(String(element.id))}
                          onTouchEnd={() => handleTableElementActivate(element)}
                          title={`${element.type} - ${element.status || 'Available'}`}
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
                                    <div style={{ fontSize: nameFontSize, fontWeight: 800 }}>
                                      {firstLine}
                                    </div>
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
                  <BistroTabPanel
                    orders={panelOrders}
                    tableStatusById={tableStatusById}
                    loading={loadingOrders}
                    onRefresh={() => void loadOrders()}
                    onSelectOrder={(orderId, tableId) => goOrder(orderId, tableId)}
                  />
                </div>
              </div>

              <div
                className="border-t py-1.5 pl-3 pr-3"
                style={{
                  height: `${footerHeightPx}px`,
                  background: '#d1d5db',
                  borderColor: '#c0c5cc',
                }}
              >
                <div className="flex h-full items-center justify-center text-sm font-semibold text-gray-600">
                  Bistro
                </div>
              </div>
            </div>
          </div>
      </div>

      <BistroContainerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        containerId={modalContainerId}
        containerTitle={modalTitle}
        containerOrders={modalOrders}
        onRefreshOrders={() => {
          void loadOrders();
          void loadMap();
        }}
        onOpenOrder={(orderId, tableId) => goOrder(orderId, tableId)}
      />
    </div>
  );
};

export default BistroSalesPage;
