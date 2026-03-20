const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '..', '..', 'db', 'web2pos.db'));

async function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function main() {
  try {
    // 1. Awesome Roll 아이템 찾기
    console.log('\n=== 1. Awesome Roll 아이템 검색 ===');
    const items = await query(`
      SELECT mi.item_id, mi.name, mi.category_id, mc.name as cat_name, mc.menu_id
      FROM menu_items mi 
      JOIN menu_categories mc ON mi.category_id = mc.category_id 
      WHERE mi.name LIKE '%Awesome%'
    `);
    console.table(items);

    if (items.length === 0) {
      console.log('Awesome Roll을 찾을 수 없습니다.');
      db.close();
      return;
    }

    // menu_id 200005의 Awesome Roll만 필터
    const awesomeRoll = items.find(i => i.menu_id === 200005) || items[0];
    const itemId = awesomeRoll.item_id;
    const catId = awesomeRoll.category_id;
    
    console.log(`\n선택된 아이템: ${awesomeRoll.name} (item_id: ${itemId}, category_id: ${catId})`);

    // 2. 아이템에 직접 연결된 모디파이어 그룹
    console.log('\n=== 2. 아이템에 직접 연결된 모디파이어 그룹 (menu_modifier_links) ===');
    const directLinks = await query(`
      SELECT mml.modifier_group_id, mg.name as group_name, mg.selection_type
      FROM menu_modifier_links mml
      LEFT JOIN modifier_groups mg ON mml.modifier_group_id = mg.group_id
      WHERE mml.item_id = ?
    `, [itemId]);
    
    if (directLinks.length === 0) {
      console.log('❌ 직접 연결된 모디파이어 그룹 없음');
    } else {
      console.table(directLinks);
    }

    // 3. 카테고리에서 상속된 모디파이어 그룹
    console.log('\n=== 3. 카테고리에서 상속된 모디파이어 그룹 (category_modifier_links) ===');
    const inheritedLinks = await query(`
      SELECT cml.modifier_group_id, mg.name as group_name, mg.selection_type
      FROM category_modifier_links cml
      LEFT JOIN modifier_groups mg ON cml.modifier_group_id = mg.group_id
      WHERE cml.category_id = ?
    `, [catId]);
    
    if (inheritedLinks.length === 0) {
      console.log('❌ 카테고리에서 상속된 모디파이어 그룹 없음');
    } else {
      console.table(inheritedLinks);
    }

    // 4. base_menu_items 확인 (상속 로직에서 사용)
    console.log('\n=== 4. base_menu_items 테이블 확인 ===');
    const baseItems = await query(`
      SELECT * FROM base_menu_items WHERE item_id = ?
    `, [itemId]);
    
    if (baseItems.length === 0) {
      console.log('❌ base_menu_items에 해당 아이템 없음 - 상속 로직이 작동하지 않을 수 있음!');
    } else {
      console.table(baseItems);
    }

    // 5. 결론
    console.log('\n=== 5. 결론 ===');
    const totalGroups = directLinks.length + inheritedLinks.length;
    if (totalGroups === 0) {
      console.log('⚠️ 이 아이템에는 연결된 모디파이어 그룹이 없습니다!');
      console.log('해결책: Menu Manager에서 이 아이템 또는 카테고리에 모디파이어 그룹을 연결해야 합니다.');
    } else {
      console.log(`✅ 총 ${totalGroups}개의 모디파이어 그룹이 연결되어 있습니다.`);
    }

    db.close();
  } catch (err) {
    console.error('Error:', err);
    db.close();
  }
}

main();

















