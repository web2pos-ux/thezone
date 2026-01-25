const http = require('http');

console.log('🔍 === 테이블 저장 API 테스트 ===\n');

// 테스트용 테이블 요소 데이터
const testElement = {
  id: 18,
  floor: 'Patio',
  type: 'rounded-rectangle',
  position: { x: 100, y: 100 },
  size: { width: 80, height: 60 },
  rotation: 0,
  text: 'T18',
  fontSize: 20,
  color: '#3B82F6',
  status: 'active'
};

const postData = JSON.stringify({
  elements: [testElement]
});

const options = {
  hostname: 'localhost',
  port: 3177,
  path: '/api/table-map/elements',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  console.log(`📡 응답 상태 코드: ${res.statusCode}`);
  console.log(`📡 응답 헤더:`, res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`📡 응답 데이터: ${data}`);
    
    if (res.statusCode === 200) {
      console.log('✅ 저장 성공!');
    } else {
      console.log('❌ 저장 실패!');
    }
  });
});

req.on('error', (err) => {
  console.error('❌ 요청 오류:', err.message);
});

req.write(postData);
req.end();

console.log('📤 전송된 데이터:', postData); 