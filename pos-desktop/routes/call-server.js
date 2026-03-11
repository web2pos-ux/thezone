// backend/routes/call-server.js
// Call Server 알림 API - 테이블 오더에서 서버 호출 시 POS/핸드헬드로 알림 전송

const express = require('express');
const router = express.Router();

// Call Server 요청 타입
const CALL_TYPES = {
  WATER: 'water',
  UTENSILS: 'utensils',
  TOGO_BOX: 'togo_box',
  BILL: 'bill',
  PAY_AT_TABLE: 'pay_at_table',
  CALL_SERVER: 'call_server'
};

// 활성 Call 요청 저장 (메모리)
const activeCallRequests = new Map();

// POST /api/call-server - 테이블에서 서버 호출
router.post('/', (req, res) => {
  try {
    const { table_id, table_label, call_type, message, store_id } = req.body;
    
    if (!table_id || !call_type) {
      return res.status(400).json({ error: 'table_id and call_type are required' });
    }
    
    // 유효한 call_type 확인
    if (!Object.values(CALL_TYPES).includes(call_type)) {
      return res.status(400).json({ error: 'Invalid call_type' });
    }
    
    const callRequest = {
      id: `CALL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      table_id,
      table_label: table_label || table_id,
      call_type,
      message: message || getDefaultMessage(call_type),
      store_id: store_id || 'default',
      status: 'pending',
      created_at: new Date().toISOString()
    };
    
    // 메모리에 저장
    activeCallRequests.set(callRequest.id, callRequest);
    
    // Socket.io로 모든 POS/핸드헬드에 알림 전송
    const io = req.app.get('io');
    if (io) {
      io.emit('call_server_request', callRequest);
      console.log(`🔔 Call Server: ${callRequest.table_label} → ${callRequest.call_type}`);
    }
    
    res.json({ 
      success: true, 
      call_id: callRequest.id,
      message: callRequest.message
    });
  } catch (error) {
    console.error('Call Server error:', error);
    res.status(500).json({ error: 'Failed to process call request' });
  }
});

// GET /api/call-server/active - 활성 호출 목록 조회
router.get('/active', (req, res) => {
  try {
    const { store_id } = req.query;
    
    const calls = Array.from(activeCallRequests.values())
      .filter(call => {
        if (store_id && call.store_id !== store_id) return false;
        return call.status === 'pending';
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    
    res.json(calls);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get active calls' });
  }
});

// PUT /api/call-server/:callId/acknowledge - 호출 확인 처리
router.put('/:callId/acknowledge', (req, res) => {
  try {
    const { callId } = req.params;
    const { acknowledged_by } = req.body;
    
    const call = activeCallRequests.get(callId);
    if (!call) {
      return res.status(404).json({ error: 'Call request not found' });
    }
    
    call.status = 'acknowledged';
    call.acknowledged_by = acknowledged_by || 'Staff';
    call.acknowledged_at = new Date().toISOString();
    
    // Socket.io로 확인 알림 전송
    const io = req.app.get('io');
    if (io) {
      io.emit('call_server_acknowledged', call);
      console.log(`✅ Call Acknowledged: ${call.table_label} by ${call.acknowledged_by}`);
    }
    
    // 5분 후 자동 삭제
    setTimeout(() => {
      activeCallRequests.delete(callId);
    }, 5 * 60 * 1000);
    
    res.json({ success: true, call });
  } catch (error) {
    res.status(500).json({ error: 'Failed to acknowledge call' });
  }
});

// PUT /api/call-server/:callId/dismiss - 호출 무시/완료 처리
router.put('/:callId/dismiss', (req, res) => {
  try {
    const { callId } = req.params;
    
    const call = activeCallRequests.get(callId);
    if (!call) {
      return res.status(404).json({ error: 'Call request not found' });
    }
    
    activeCallRequests.delete(callId);
    
    // Socket.io로 삭제 알림
    const io = req.app.get('io');
    if (io) {
      io.emit('call_server_dismissed', { call_id: callId });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to dismiss call' });
  }
});

// 기본 메시지 생성
function getDefaultMessage(callType) {
  const messages = {
    [CALL_TYPES.WATER]: 'Water refill requested',
    [CALL_TYPES.UTENSILS]: 'Utensils requested',
    [CALL_TYPES.TOGO_BOX]: 'Togo box requested',
    [CALL_TYPES.BILL]: 'Bill requested',
    [CALL_TYPES.PAY_AT_TABLE]: 'Pay at table requested',
    [CALL_TYPES.CALL_SERVER]: 'Server called to table'
  };
  return messages[callType] || 'Assistance requested';
}

module.exports = router;

