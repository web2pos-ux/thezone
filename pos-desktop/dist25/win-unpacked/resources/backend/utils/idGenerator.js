const ID_RANGES = {
  // Menu Structure
  MENU: { min: 200000, max: 204999, table: 'menus', column: 'menu_id' },
  CATEGORY: { min: 205000, max: 224999, table: 'menu_categories', column: 'category_id' },
  MENU_ITEM: { min: 225000, max: 254999, table: 'menu_items', column: 'item_id' },
  
  // System & User
  EMPLOYEE: { min: 255000, max: 289999, table: 'employees', column: 'employee_id' },
  TABLE_MAP_ELEMENT: { min: 290000, max: 292999, table: 'table_map_elements', column: 'element_id' },
  QR_ORDER: { min: 293000, max: 295999, table: 'qr_orders', column: 'qr_id' },
  TABLE_DEVICE: { min: 296000, max: 299999, table: 'table_devices', column: 'device_id' },
  
  // Modifier System
  MODIFIER: { min: 300000, max: 339999, table: 'modifiers', column: 'modifier_id' },
  MODIFIER_GROUP: { min: 340000, max: 379999, table: 'modifier_groups', column: 'modifier_group_id' },
  
  // Tax System
  TAX: { min: 380000, max: 384999, table: 'taxes', column: 'tax_id' },
  TAX_GROUP: { min: 385000, max: 389999, table: 'tax_groups', column: 'tax_group_id' },
  
  // Printer System
  PRINTER: { min: 390000, max: 394999, table: 'printers', column: 'printer_id' },
  PRINTER_GROUP: { min: 395000, max: 399999, table: 'printer_groups', column: 'printer_group_id' },
  
  // Link Tables (for many-to-many relationships)
      MODIFIER_MENU_LINK: { min: 400000, max: 409999, table: 'menu_modifier_links', column: 'link_id' },
  TAX_MENU_LINK: { min: 410000, max: 419999, table: 'menu_tax_links', column: 'link_id' },
  PRINTER_MENU_LINK: { min: 420000, max: 429999, table: 'menu_printer_links', column: 'link_id' },
  
  // Category Level Link Tables
  CATEGORY_MODIFIER_LINK: { min: 440000, max: 449999, table: 'category_modifier_links', column: 'id' },
  CATEGORY_TAX_LINK: { min: 450000, max: 459999, table: 'category_tax_links', column: 'id' },
  CATEGORY_PRINTER_LINK: { min: 460000, max: 469999, table: 'category_printer_links', column: 'id' },
  
  // Additional System Tables
  MODIFIER_LABEL: { min: 430000, max: 434999, table: 'modifier_labels', column: 'label_id' },
  MODIFIER_TYPE: { min: 435000, max: 439999, table: 'modifier_types', column: 'type_id' },

};

/**
 * 지정된 범위 내에서 사용 가능한 다음 ID를 비동기적으로 생성합니다.
 * @param {object} db - SQLite 데이터베이스 연결 객체
 * @param {object} rangeInfo - ID_RANGES에 정의된 범위 정보 객체
 * @returns {Promise<number>} 생성된 새 ID
 */
async function generateNextId(db, rangeInfo) {
  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  const { min, max, table, column } = rangeInfo;
  const query = `SELECT MAX(${column}) as maxId FROM ${table} WHERE ${column} >= ? AND ${column} <= ?`;

  try {
    const row = await dbGet(query, [min, max]);
    const nextId = row && row.maxId ? row.maxId + 1 : min;

    if (nextId > max) {
      throw new Error(`ID range exhausted for ${table}.`);
    }
    return nextId;
  } catch (err) {
    throw new Error(`Database error while generating ID for ${table}: ${err.message}`);
  }
}

module.exports = {
  ID_RANGES,
  generateNextId,
  
  // Menu Structure
  generateMenuId: (db) => generateNextId(db, ID_RANGES.MENU),
  generateCategoryId: (db) => generateNextId(db, ID_RANGES.CATEGORY),
  generateMenuCategoryId: (db) => generateNextId(db, ID_RANGES.CATEGORY),
  generateMenuItemId: (db) => generateNextId(db, ID_RANGES.MENU_ITEM),
  
  // System & User
  generateEmployeeId: (db) => generateNextId(db, ID_RANGES.EMPLOYEE),
  generateTableMapElementId: (db) => generateNextId(db, ID_RANGES.TABLE_MAP_ELEMENT),
  generateQrOrderId: (db) => generateNextId(db, ID_RANGES.QR_ORDER),
  generateTableDeviceId: (db) => generateNextId(db, ID_RANGES.TABLE_DEVICE),
  
  // Modifier System
  generateModifierId: (db) => generateNextId(db, ID_RANGES.MODIFIER),
  generateModifierGroupId: (db) => generateNextId(db, ID_RANGES.MODIFIER_GROUP),
  generateModifierMenuLinkId: (db) => generateNextId(db, ID_RANGES.MODIFIER_MENU_LINK),
  generateModifierLabelId: (db) => generateNextId(db, ID_RANGES.MODIFIER_LABEL),
  generateModifierTypeId: (db) => generateNextId(db, ID_RANGES.MODIFIER_TYPE),

  
  // Tax System
  generateTaxId: (db) => generateNextId(db, ID_RANGES.TAX),
  generateTaxGroupId: (db) => generateNextId(db, ID_RANGES.TAX_GROUP),
  generateTaxMenuLinkId: (db) => generateNextId(db, ID_RANGES.TAX_MENU_LINK),
  
  // Printer System
  generatePrinterId: (db) => generateNextId(db, ID_RANGES.PRINTER),
  generatePrinterGroupId: (db) => generateNextId(db, ID_RANGES.PRINTER_GROUP),
  generatePrinterMenuLinkId: (db) => generateNextId(db, ID_RANGES.PRINTER_MENU_LINK),
  
  // Category Level Link System
  generateCategoryModifierLinkId: (db) => generateNextId(db, ID_RANGES.CATEGORY_MODIFIER_LINK),
  generateCategoryTaxLinkId: (db) => generateNextId(db, ID_RANGES.CATEGORY_TAX_LINK),
  generateCategoryPrinterLinkId: (db) => generateNextId(db, ID_RANGES.CATEGORY_PRINTER_LINK),

}; 