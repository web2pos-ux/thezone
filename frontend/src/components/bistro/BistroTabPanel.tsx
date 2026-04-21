import React, { useMemo } from 'react';
import {
  formatBistroMoney,
  getBistroTabCardVisualStatus,
  getBistroTabGrandTotalInclTax,
  getBistroTabLabel,
  getBistroTabServerDisplayName,
  getBistroTabTableDisplayLabel,
} from '../../utils/bistroOrderHelpers';
import {
  getBistroTabCardNeumorphicSurfaceStyle,
  getBistroTabCardTextTheme,
} from '../../utils/bistroTabCardTheme';
import { NEO_PREP_TIME_BTN_PRESS } from '../../utils/softNeumorphic';

export type BistroTabPanelProps = {
  orders: any[];
  /** 테이블 element_id → 맵 status (Occupied / Payment Pending 등) */
  tableStatusById: Record<string, string>;
  onSelectOrder: (orderId: number, tableId: string) => void;
  /** 부모에서 폴링 시 사용 (UI 버튼 없음) */
  onRefresh?: () => void;
  loading?: boolean;
};

/** 우측 패널: 탭 카드 목록만 (DLV/투고 버튼·헤더 없음) */
const BistroTabPanel: React.FC<BistroTabPanelProps> = ({
  orders,
  tableStatusById,
  onSelectOrder,
}) => {
  const sortedOrders = useMemo(() => {
    return [...orders].sort((a, b) =>
      getBistroTabLabel(a).localeCompare(getBistroTabLabel(b), undefined, {
        sensitivity: 'base',
        numeric: true,
      })
    );
  }, [orders]);

  return (
    <aside className="flex h-full w-full min-w-0 flex-col overflow-hidden text-gray-800">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {orders.length === 0 && (
          <p className="p-2 text-sm text-gray-500">오픈 탭이 없습니다.</p>
        )}
        <ul className="grid grid-cols-2 items-start gap-2 md:grid-cols-3">
          {sortedOrders.map((o) => {
            const tid = String(o.table_id || '').trim();
            const tabName = getBistroTabLabel(o);
            const serverName = getBistroTabServerDisplayName(o);
            const tableLabel = getBistroTabTableDisplayLabel(o);
            const totalIncl = getBistroTabGrandTotalInclTax(o);
            const visual = getBistroTabCardVisualStatus(o, tableStatusById);
            const textTheme = getBistroTabCardTextTheme(visual);
            return (
              <li key={o.id} className="min-w-0 self-start">
                <button
                  type="button"
                  style={getBistroTabCardNeumorphicSurfaceStyle(visual)}
                  className={`flex min-h-[4.3284375rem] w-full flex-col items-stretch px-2.5 py-2 text-left outline-none sm:min-h-[4.501575rem] sm:px-3 sm:py-2.5 ${NEO_PREP_TIME_BTN_PRESS}`}
                  onClick={() => onSelectOrder(Number(o.id), tid)}
                >
                  <span
                    className="mb-1 min-w-0 break-words text-[15px] font-extrabold leading-snug tracking-tight sm:text-base"
                    style={{
                      color: textTheme.title,
                      textShadow:
                        visual === 'Payment Pending' ? '0 1px 2px rgba(0,0,0,0.22)' : undefined,
                    }}
                  >
                    {tabName}
                  </span>
                  <div className="flex min-w-0 items-baseline justify-between gap-2 text-[13px] font-extrabold leading-snug tracking-tight sm:text-sm">
                    <span
                      className="min-w-0 truncate font-extrabold"
                      style={{
                        color: textTheme.title,
                        textShadow:
                          visual === 'Payment Pending' ? '0 1px 2px rgba(0,0,0,0.22)' : undefined,
                      }}
                      title={tableLabel}
                    >
                      {tableLabel}
                    </span>
                    <span
                      className="max-w-[58%] shrink-0 truncate text-right font-extrabold"
                      style={{
                        color: textTheme.title,
                        textShadow:
                          visual === 'Payment Pending' ? '0 1px 2px rgba(0,0,0,0.22)' : undefined,
                      }}
                      title={serverName}
                    >
                      {serverName}
                    </span>
                  </div>
                  <div
                    className="mt-1 border-t-2 border-white/55 pt-1 text-[17px] font-bold tabular-nums leading-none sm:text-lg"
                    style={{
                      color: textTheme.amount,
                      textShadow:
                        visual === 'Payment Pending' ? '0 1px 2px rgba(0,0,0,0.2)' : undefined,
                    }}
                  >
                    {formatBistroMoney(totalIncl)}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
};

export default BistroTabPanel;
