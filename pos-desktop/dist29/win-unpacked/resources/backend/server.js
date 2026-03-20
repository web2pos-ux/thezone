// 프린터 비퍼 알림 API
app.post('/api/printer/beep', async (req, res) => {
  try {
    const { beepCommand, printerType } = req.body;
    
    console.log(`Printer beep request - Type: ${printerType}, Command: ${beepCommand}`);
    
    // 실제 프린터로 비퍼 명령 전송
    // 여기서는 예시로 콘솔 출력만 함
    // 실제 구현 시에는 프린터 드라이버나 직렬 포트 통신을 사용
    
    if (printerType === 'server') {
      // 서버용 프린터에 비퍼 명령 전송
      // 예: 시리얼 포트나 네트워크 프린터로 ESC/POS 명령 전송
      
      // 시뮬레이션: 실제로는 프린터 라이브러리 사용
      console.log('🔔 Server printer beep triggered!');
      console.log(`Beep command sent: ${beepCommand.split('').map(c => c.charCodeAt(0).toString(16)).join(' ')}`);
      
      // 성공 응답
      res.json({ 
        success: true, 
        message: 'Printer beep command sent successfully',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({ 
        success: false, 
        message: 'Invalid printer type' 
      });
    }
    
  } catch (error) {
    console.error('Printer beep error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send printer beep command',
      error: error.message 
    });
  }
});

// 간단 메모 인쇄 API: 키친 프린터로 메모 전송
app.post('/api/printers/print-memo', async (req, res) => {
  try {
    const { message = '', orderNumber = null, context = {} } = req.body || {};
    const text = String(message || '').trim();
    if (!text) return res.status(400).json({ success: false, error: 'Empty memo' });

    // TODO: 실제 키친 프린터 연동 (ESC/POS 등)
    console.log('[KITCHEN MEMO]', {
      message: text,
      orderNumber: orderNumber || undefined,
      context,
      at: new Date().toISOString(),
    });

    // 여기서는 성공 응답만 반환
    res.json({ success: true });
  } catch (e) {
    console.error('Failed to print memo:', e);
    res.status(500).json({ success: false, error: 'Failed to print memo' });
  }
});
