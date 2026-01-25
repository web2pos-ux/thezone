const http = require('http');

console.log('🔍 === 간단한 테이블 저장 테스트 ===\n');

// 최소한의 테이블 요소 데이터
const testElement = {
  id: 1,
  floor: 'Patio',
  type: 'rounded-rectangle',
  position: { x: 100, y: 100 },
  size: { width: 80, height: 60 }
};

const postData = JSON.stringify({
  elements: [testElement]
});

console.log('📤 전송할 데이터:', postData);

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