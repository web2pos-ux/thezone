const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const cleanupBusinessHoursFinal = async () => {
  try {
    console.log('Final cleanup of business hours data...');
    
    // Get all business hours
    const allHours = await dbAll('SELECT * FROM business_hours ORDER BY day_of_week, id');
    console.log(`Found ${allHours.length} business hours records`);
    
    // Group by day_of_week
    const groupedHours = {};
    allHours.forEach(hour => {
      if (!groupedHours[hour.day_of_week]) {
        groupedHours[hour.day_of_week] = [];
      }
      groupedHours[hour.day_of_week].push(hour);
    });
    
    // Keep only the latest record for each day and delete all others
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    for (const [dayOfWeek, hours] of Object.entries(groupedHours)) {
      if (hours.length > 1) {
        console.log(`${dayNames[dayOfWeek]}: ${hours.length} records found, keeping only the latest one`);
        
        // Sort by id (latest first) and keep only the first one
        const latestHour = hours.sort((a, b) => b.id - a.id)[0];
        
        // Delete all other records for this day
        const otherIds = hours.filter(h => h.id !== latestHour.id).map(h => h.id);
        if (otherIds.length > 0) {
          await dbRun('DELETE FROM business_hours WHERE id IN (' + otherIds.map(() => '?').join(',') + ')', otherIds);
          console.log(`Deleted ${otherIds.length} duplicate records for ${dayNames[dayOfWeek]}`);
        }
      }
    }
    
    // Verify cleanup
    const finalHours = await dbAll('SELECT * FROM business_hours ORDER BY day_of_week');
    console.log(`\nFinal business hours (${finalHours.length} records):`);
    finalHours.forEach(hour => {
      console.log(`  ${dayNames[hour.day_of_week]}: ${hour.open_time} - ${hour.close_time} (${hour.is_open ? 'Open' : 'Closed'})`);
    });
    
    // Ensure we have exactly 7 records (one for each day)
    if (finalHours.length !== 7) {
      console.log('\n⚠️  Warning: Not exactly 7 records found. Creating missing days...');
      
      const existingDays = finalHours.map(h => h.day_of_week);
      const missingDays = [];
      
      for (let i = 0; i < 7; i++) {
        if (!existingDays.includes(i)) {
          missingDays.push(i);
        }
      }
      
      for (const dayOfWeek of missingDays) {
        await dbRun(`
          INSERT INTO business_hours (day_of_week, open_time, close_time, is_open, created_at, updated_at)
          VALUES (?, '11:00', '22:00', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [dayOfWeek]);
        console.log(`Created missing record for ${dayNames[dayOfWeek]}`);
      }
    }
    
    console.log('\n✅ Final business hours cleanup completed!');
  } catch (error) {
    console.error('Error cleaning up business hours:', error);
  } finally {
    db.close();
  }
};

cleanupBusinessHoursFinal(); 
