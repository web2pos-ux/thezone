// Test Work Schedule API endpoints
const API_BASE = 'http://localhost:3177/api/work-schedule';

async function testAPI(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await response.json();
    
    console.log(`\n✅ ${method} ${endpoint}`);
    console.log(`Status: ${response.status}`);
    console.log('Response:', JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error(`\n❌ ${method} ${endpoint}`);
    console.error('Error:', error.message);
    return null;
  }
}

async function runTests() {
  console.log('=================================');
  console.log('Work Schedule API Test Suite');
  console.log('=================================');
  
  // Test 1: Get all employees
  console.log('\n📋 Test 1: Get all employees');
  await testAPI('/employees');
  
  // Test 2: Get all schedules
  console.log('\n📋 Test 2: Get all schedules');
  await testAPI('/schedules');
  
  // Test 3: Create a schedule
  console.log('\n📋 Test 3: Create a schedule');
  const newSchedule = {
    employeeId: '1',
    date: '2025-10-28',
    scheduledStart: '09:00',
    scheduledEnd: '17:00',
  };
  await testAPI('/schedules', 'POST', newSchedule);
  
  // Test 4: Get schedules with date filter
  console.log('\n📋 Test 4: Get schedules with date filter');
  await testAPI('/schedules?startDate=2025-10-28&endDate=2025-10-31');
  
  // Test 5: Get all shift swap requests
  console.log('\n📋 Test 5: Get all shift swap requests');
  await testAPI('/shift-swaps');
  
  // Test 6: Create a shift swap request
  console.log('\n📋 Test 6: Create a shift swap request');
  const newShiftSwap = {
    id: `SS-${Date.now()}`,
    employee1Id: '1',
    employee1Name: 'John Smith',
    employee1Date: '2025-10-28',
    employee1Time: '09:00',
    employee2Id: '2',
    employee2Name: 'Jane Doe',
    employee2Date: '2025-10-28',
    employee2Time: '10:00',
    status: 'pending',
    mode: 'swap',
    requestedDate: new Date().toISOString().split('T')[0],
  };
  const createdSwap = await testAPI('/shift-swaps', 'POST', newShiftSwap);
  
  // Test 7: Get all time off requests
  console.log('\n📋 Test 7: Get all time off requests');
  await testAPI('/time-off');
  
  // Test 8: Create a time off request
  console.log('\n📋 Test 8: Create a time off request');
  const newTimeOff = {
    id: `TO-${Date.now()}`,
    employeeId: '1',
    employeeName: 'John Smith',
    type: 'vacation',
    startDate: '2025-11-01',
    endDate: '2025-11-03',
    reason: 'Family vacation',
    status: 'pending',
    requestedDate: new Date().toISOString().split('T')[0],
  };
  const createdTimeOff = await testAPI('/time-off', 'POST', newTimeOff);
  
  // Test 9: Update shift swap status
  if (createdSwap && createdSwap.id) {
    console.log('\n📋 Test 9: Update shift swap status to approved');
    await testAPI(`/shift-swaps/${createdSwap.id}`, 'PUT', {
      status: 'approved',
      approver: 'Manager',
      approvedDate: new Date().toISOString().split('T')[0],
    });
  }
  
  // Test 10: Update time off status
  if (createdTimeOff && createdTimeOff.id) {
    console.log('\n📋 Test 10: Update time off status to approved');
    await testAPI(`/time-off/${createdTimeOff.id}`, 'PUT', {
      status: 'approved',
      approver: 'Manager',
      approvedDate: new Date().toISOString().split('T')[0],
    });
  }
  
  // Test 11: Get activity logs
  console.log('\n📋 Test 11: Get activity logs');
  await testAPI('/activity-logs');
  
  // Test 12: Create activity log
  console.log('\n📋 Test 12: Create activity log');
  const newLog = {
    id: `LOG-${Date.now()}`,
    type: 'schedule',
    action: 'created',
    employeeId: '1',
    employeeName: 'John Smith',
    details: 'Schedule created for testing',
    timestamp: new Date().toISOString(),
    user: 'Test User',
  };
  await testAPI('/activity-logs', 'POST', newLog);
  
  // Test 13: Bulk create schedules
  console.log('\n📋 Test 13: Bulk create schedules');
  const bulkSchedules = [
    {
      employeeId: '2',
      date: '2025-10-28',
      scheduledStart: '10:00',
      scheduledEnd: '18:00',
    },
    {
      employeeId: '3',
      date: '2025-10-28',
      scheduledStart: '08:00',
      scheduledEnd: '16:00',
    },
  ];
  await testAPI('/schedules/bulk', 'POST', { schedules: bulkSchedules });
  
  console.log('\n=================================');
  console.log('✅ All tests completed!');
  console.log('=================================');
}

// Run tests
runTests().catch(console.error);


