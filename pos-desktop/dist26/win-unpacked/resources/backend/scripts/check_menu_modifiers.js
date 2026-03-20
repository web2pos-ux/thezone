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
    // 1. Order Page Setups 확인
    console.log('\n=== 1. Order Page Setups (채널별 메뉴 연결) ===');
    const setups = await query('SELECT order_type, menu_id, menu_name FROM order_page_setups');
    console.table(setups);

    // 2. 메뉴 목록 확인
    console.log('\n=== 2. 메뉴 목록 ===');
    const menus = await query('SELECT menu_id, name FROM menus ORDER BY menu_id');
    console.table(menus);

    // 3. Special Roll 카테고리 찾기
    console.log('\n=== 3. Special Roll 카테고리 ===');
    const cats = await query(`SELECT * FROM menu_categories WHERE name LIKE '%Special%' OR name LIKE '%Roll%' LIMIT 10`);
    console.table(cats);

    // 4. menu_id 200005의 Special Roll 카테고리
    console.log('\n=== 4. menu_id 200005의 카테고리 중 Special Roll ===');
    const specialCats = await query(`SELECT category_id, name FROM menu_categories WHERE menu_id = 200005 AND name LIKE '%Special%'`);
    console.table(specialCats);

    if (specialCats.length > 0) {
      const catId = specialCats[0].category_id;
      
      // 5. 해당 카테고리의 아이템
      console.log(`\n=== 5. Special Roll 카테고리(${catId})의 아이템 (처음 5개) ===`);
      const items = await query('SELECT item_id, name FROM menu_items WHERE category_id = ? LIMIT 5', [catId]);
      console.table(items);

      if (items.length > 0) {
        const itemId = items[0].item_id;
        
        // 6. 아이템에 직접 연결된 모디파이어 그룹
        console.log(`\n=== 6. 아이템(${itemId})에 직접 연결된 모디파이어 그룹 (menu_modifier_links) ===`);
        const directLinks = await query(`
          SELECT mml.modifier_group_id, mg.name as group_name
          FROM menu_modifier_links mml
          LEFT JOIN modifier_groups mg ON mml.modifier_group_id = mg.group_id
          WHERE mml.item_id = ?
        `, [itemId]);
        console.table(directLinks);

        // 7. 카테고리에서 상속된 모디파이어 그룹
        console.log(`\n=== 7. 카테고리(${catId})에서 상속된 모디파이어 그룹 (category_modifier_links) ===`);
        const inheritedLinks = await query(`
          SELECT cml.modifier_group_id, mg.name as group_name
          FROM category_modifier_links cml
          LEFT JOIN modifier_groups mg ON cml.modifier_group_id = mg.group_id
          WHERE cml.category_id = ?
        `, [catId]);
        console.table(inheritedLinks);

        // 8. 모디파이어 그룹이 있다면 그 안의 모디파이어들
        const allGroups = [...directLinks, ...inheritedLinks];
        if (allGroups.length > 0) {
          const groupId = allGroups[0].modifier_group_id;
          console.log(`\n=== 8. 모디파이어 그룹(${groupId})의 옵션들 ===`);
          const mods = await query(`
            SELECT m.modifier_id, m.name, m.price_delta
            FROM modifiers m
            JOIN modifier_group_links mgl ON m.modifier_id = mgl.modifier_id
            WHERE mgl.modifier_group_id = ?
          `, [groupId]);
          console.table(mods);
        }
      }
    }

    db.close();
  } catch (err) {
    console.error('Error:', err);
    db.close();
  }
}

main();

















