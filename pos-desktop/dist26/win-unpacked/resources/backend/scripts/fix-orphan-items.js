/**
 * 카테고리가 없는 아이템들을 적절한 카테고리로 재할당
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../db/web2pos.db');
const db = new sqlite3.Database(dbPath);

// 카테고리 매핑 (이름 기준으로 적절한 카테고리로 이동)
const categoryMap = {
  'Chicken Teriyaki Bento': 205010,   // LUNCH SPECIAL SET
  'Beef Teriyaki Bento': 205010,      // LUNCH SPECIAL SET
  'Salmon Teriyaki Bento': 205010,    // LUNCH SPECIAL SET
  'Spicy Sashimi & Oshi Bento': 205010, // LUNCH SPECIAL SET
  'Veggie Sunomono': 205011,          // SALADS
  'Ebi Sunomono': 205011,             // SALADS
  'Miso': 205012,                     // APPETIZER
  'Spring Roll 4pcs': 205012,         // APPETIZER
  'Takoyaki': 205012                  // APPETIZER
};

async function fixItems() {
  console.log('='.repeat(60));
  console.log('Fixing orphan items (reassigning categories)');
  console.log('='.repeat(60));
  
  let updated = 0;
  
  for (const [name, catId] of Object.entries(categoryMap)) {
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE menu_items SET category_id = ? WHERE name = ? AND menu_id = 200005',
        [catId, name],
        function(err) {
          if (err) {
            console.log('Error:', err);
            reject(err);
          } else if (this.changes > 0) {
            updated++;
            console.log(`Updated: ${name} -> category ${catId}`);
          }
          resolve();
        }
      );
    });
  }
  
  console.log(`\nTotal updated: ${updated} items`);
  db.close();
}

fixItems().catch(err => {
  console.error('Failed:', err);
  db.close();
});
