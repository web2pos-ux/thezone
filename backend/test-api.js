const http = require('http');

console.log('🔍 === API 테스트 시작 ===\n');

// 1. 상태 확인 API 테스트
console.log('1️⃣ 상태 확인 API 테스트...');
const statusReq = http.get('http://localhost:3177/api/table-map/status', (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`   상태 코드: ${res.statusCode}`);
    console.log(`   응답 데이터: ${data}`);
    console.log('');
    
    // 2. 요소 조회 API 테스트
    console.log('2️⃣ 1F 요소 조회 API 테스트...');
    const elementsReq = http.get('http://localhost:3177/api/table-map/elements?floor=1F', (res2) => {
      let data2 = '';
      
      res2.on('data', (chunk) => {
        data2 += chunk;
      });
      
      res2.on('end', () => {
        console.log(`   상태 코드: ${res2.statusCode}`);
        console.log(`   응답 데이터: ${data2}`);
        console.log('');
        
        // 3. 화면 설정 조회 API 테스트
        console.log('3️⃣ 1F 화면 설정 조회 API 테스트...');
        const screenReq = http.get('http://localhost:3177/api/table-map/screen-size?floor=1F', (res3) => {
          let data3 = '';
          
          res3.on('data', (chunk) => {
            data3 += chunk;
          });
          
          res3.on('end', () => {
            console.log(`   상태 코드: ${res3.statusCode}`);
            console.log(`   응답 데이터: ${data3}`);
            console.log('\n✅ 모든 API 테스트 완료!');
          });
        });
        
        screenReq.on('error', (err) => {
          console.log(`   ❌ 오류: ${err.message}`);
        });
      });
    });
    
    elementsReq.on('error', (err) => {
      console.log(`   ❌ 오류: ${err.message}`);
    });
  });
});

statusReq.on('error', (err) => {
  console.log(`   ❌ 오류: ${err.message}`);
  console.log('\n❌ API 테스트 실패!');
}); 