import sys

file_path = 'frontend/src/pages/OrderPage.tsx'
# Note: Adjusting markers based on read_file output
start_marker = '  // OK: 프린터 전송 → 주문 초기화 → /sales 복귀 (빈 주문이면 바로 이동)'
end_marker = '  const handleVoidPayment = async (paymentId: number) => {'

new_content = """  // OK: 프린터 전송 → 주문 초기화 → /sales 복귀 (빈 주문이면 바로 이동)
  const handleOkClick = async () => {
    try {
      const items = (orderItems || []).filter(it => it.type === 'item');
      const tableIdForMap = (location.state && (location.state as any).tableId) || null;
      const floor = (location.state && (location.state as any).floor) || null;
      const allGuestsPaid = (() => {
        try {
          const ids = Array.isArray(guestIds) ? guestIds : [];
          if (ids.length === 0) return false;
          return ids.every(g => (guestStatusMap as any)[g] === 'PAID');
        } catch { return false; }
      })();

      // If nothing to save OR everything is already paid → don't create/update order; mark table Preparing and exit
      if (items.length === 0 || allGuestsPaid) {
        try {
          if (tableIdForMap) {
            await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tableIdForMap)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Preparing' }) });
            try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId: tableIdForMap, floor, status: 'Preparing', ts: Date.now() })); } catch {}
            try { localStorage.removeItem(`lastOrderIdByTable_${tableIdForMap}`); } catch {}
            try { localStorage.removeItem(`voidDisplay_${tableIdForMap}`); } catch {}
          }
        } catch {}
        clearServerAssignmentForContext();
        setSelectedServer(null);
        navigate('/sales');
        return;
      }

      // 저장 전 상태 확인 (새 주문인지 업데이트인지)
      const wasUpdateMode = !!savedOrderIdRef.current;
      const hasNewItems = items.some((it:any) => !it.orderLineId);

      // 1. DB 저장
      const saved = await saveOrderToBackend();
      
      // 2. 주방 프린트
      if (saved) {
         await printKitchenOrders(wasUpdateMode);
      }

      // 3. 게스트 상태 저장
      try {
        const orderId = savedOrderIdRef.current;
        if (orderId) {
          const statuses = Object.entries(guestStatusMap).map(([g, st]) => ({ guestNumber: Number(g), status: st, locked: st === 'PAID' }));
          await fetch(`${API_URL}/orders/${encodeURIComponent(String(orderId))}/guest-status/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ statuses })
          });
        }
      } catch {}

      // 4. Split 정보 저장
      try {
        if (tableIdForMap) {
          const guestNumbers = Array.from(new Set((orderItems || []).filter(it => it.type === 'separator' && typeof it.guestNumber === 'number').map(it => it.guestNumber as number))).sort((a,b)=>a-b);
          if (guestNumbers.length > 1) {
            localStorage.setItem(`splitGuests_${tableIdForMap}`, JSON.stringify(guestNumbers));
          } else {
            localStorage.removeItem(`splitGuests_${tableIdForMap}`);
          }
        }
      } catch {}

      // 5. 테이블 상태 업데이트
      try {
        const tableId = tableIdForMap;
        if (tableId) {
          let currentIsPaymentPending = false;
          try {
             const last = JSON.parse(localStorage.getItem('lastOccupiedTable') || '{}');
             if (String(last.tableId) === String(tableId) && last.status === 'Payment Pending') currentIsPaymentPending = true;
          } catch {}

          const nextStatus = 'Occupied';

          if (hasNewItems) {
             // 새로운 아이템이 추가되었으면 무조건 Occupied
             await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tableId)}/status`, {
               method: 'PATCH',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ status: nextStatus })
             });
             const floor = (location.state as any)?.floor || '1F';
             try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId, floor, status: nextStatus, ts: Date.now() })); } catch {}
          } else if (!currentIsPaymentPending) {
             // Payment Pending이 아니면 Occupied로 강제 (기존 로직 유지)
             await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tableId)}/status`, {
               method: 'PATCH',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ status: nextStatus })
             });
             const floor = (location.state as any)?.floor || '1F';
             try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId, floor, status: nextStatus, ts: Date.now() })); } catch {}
          } else {
             // Payment Pending이고 새 아이템이 없으면 -> 상태 변경 안 함 (Payment Pending 유지)
          }
        }
      } catch (e) {
        console.warn('테이블 상태 업데이트 실패(무시):', e);
      }

      // 5) 정리 및 이동: 테이블맵으로 이동하지만, VOID 표시를 유지하기 위해 로컬 스냅샷은 삭제하지 않음
      navigate('/sales');
    } catch (e) {
      console.error('OK flow failed', e);
      alert('OK 처리 실패');
    }
  };

"""

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if start_marker in line:
        start_idx = i
    if end_marker in line:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    new_lines = lines[:start_idx] + [new_content] + lines[end_idx:]
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print("Successfully replaced handleOkClick.")
else:
    print("Could not find markers.")
    print(f"Start: {start_idx}, End: {end_idx}")




