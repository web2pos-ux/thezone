const http = require('http');

console.log('🔍 === 백엔드 API 상태 확인 ===\n');

// API 엔드포인트 테스트
const testEndpoints = [
  { name: '1F 요소 조회', url: 'http://localhost:3177/api/table-map/elements?floor=1F' },
  { name: 'Patio 요소 조회', url: 'http://localhost:3177/api/table-map/elements?floor=Patio' },
  { name: '1F 화면 설정', url: 'http://localhost:3177/api/table-map/screen-size?floor=1F' },
  { name: 'Patio 화면 설정', url: 'http://localhost:3177/api/table-map/screen-size?floor=Patio' }
];

let completedTests = 0;

function testEndpoint(test) {
  return new Promise((resolve) => {
    const req = http.get(test.url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          const elementCount = Array.isArray(jsonData) ? jsonData.length : 'N/A';
          const dataSize = (data.length / 1024).toFixed(1);
          
          console.log(`✅ ${test.name}:`);
          console.log(`   상태: ${res.statusCode}`);
          console.log(`   데이터 크기: ${dataSize} kB`);
          console.log(`   요소 개수: ${elementCount}`);
          
          if (Array.isArray(jsonData) && jsonData.length > 0) {
            console.log(`   첫 번째 요소: ${jsonData[0].element_type || 'N/A'}`);
          }
          console.log('');
          
        } catch (e) {
          console.log(`❌ ${test.name}: JSON 파싱 실패 - ${data.substring(0, 100)}...`);
          console.log('');
        }
        
        completedTests++;
        if (completedTests === testEndpoints.length) {
          console.log('✅ 모든 API 테스트 완료');
        }
        
        resolve();
      });
    });
    
    req.on('error', (err) => {
      console.log(`❌ ${test.name}: 연결 실패 - ${err.message}`);
      console.log('');
      
      completedTests++;
      if (completedTests === testEndpoints.length) {
        console.log('✅ 모든 API 테스트 완료');
      }
      
      resolve();
    });
    
    req.setTimeout(5000, () => {
      console.log(`⏰ ${test.name}: 타임아웃 (5초)`);
      console.log('');
      
      req.destroy();
      completedTests++;
      if (completedTests === testEndpoints.length) {
        console.log('✅ 모든 API 테스트 완료');
      }
      
      resolve();
    });
  });
}

// 모든 엔드포인트 테스트
async function runTests() {
  console.log('🚀 API 테스트 시작...\n');
  
  for (const test of testEndpoints) {
    await testEndpoint(test);
  }
}

runTests(); 
