#!/usr/bin/env node

const { execSync } = require('child_process');

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

const protectedGroups = [
  {
    key: 'split',
    label: 'Split Order',
    env: 'ALLOW_SPLIT_EDITS',
    files: [
      'frontend/src/hooks/useOrderManagement.ts',
      'frontend/src/pages/OrderPage.tsx',
    ],
  },
  {
    key: 'vkeyboard',
    label: 'Virtual Keyboard Module',
    env: 'ALLOW_VKEY_EDITS',
    files: [
      'frontend/src/components/order/VirtualKeyboard.tsx',
    ],
  },
  {
    key: 'payment',
    label: 'Payment Modal / Split Payment / Payments API',
    env: 'ALLOW_PAYMENT_MODAL_EDITS',
    files: [
      'frontend/src/components/PaymentModal.tsx',
      'frontend/src/components/PaymentCompleteModal.tsx',
      'frontend/src/components/SplitBillModal.tsx',
      'frontend/src/pages/order/modules/PaymentSplitModals.tsx',
      'backend/routes/payments.js',
      'pos-desktop/backend/routes/payments.js',
    ],
  },
  {
    key: 'order-screen-dnd',
    label: 'Order Screen DnD / Merge / Color / Move / Empty Slot',
    env: 'ALLOW_ORDER_DND_EDITS',
    files: [
      'frontend/src/components/order/MenuItemGrid.tsx',
      'frontend/src/components/order/ModifierPanel.tsx',
      'frontend/src/pages/order/OrderCatalogPanel.tsx',
    ],
  },
  {
    key: 'order-page',
    label: 'Order Page / Order Flow / Order Components',
    env: 'ALLOW_ORDER_PAGE_EDITS',
    files: [
      'frontend/src/pages/OrderPage.tsx',
      'frontend/src/pages/TableOrderPage.tsx',
      'frontend/src/pages/QsrOrderPage.tsx',
      'frontend/src/pages/PosOrderPage.tsx',
      'frontend/src/pages/KioskOrderPage.tsx',
      'frontend/src/pages/QrOrderPage.tsx',
      'frontend/src/pages/OnlineOrderPage.tsx',
      'frontend/src/pages/OrderSetupPage.tsx',
      'frontend/src/pages/OrderPageManagerPage.tsx',
      'frontend/src/components/order/BottomActionBar.tsx',
      'frontend/src/components/order/CategoryBar.tsx',
      'frontend/src/components/order/VirtualKeyboard.tsx',
      'frontend/src/components/OrderDetailModal.tsx',
      'frontend/src/components/OnlineOrderPanel.tsx',
      'frontend/src/pages/order/orderTypes.ts',
      'frontend/src/pages/order/OrderLoadingSkeleton.tsx',
      'frontend/src/pages/order/CatalogSnapshotOverlay.tsx',
      'frontend/src/utils/orderSequence.ts',
      'frontend/src/utils/orderBootstrap.ts',
      'frontend/src/hooks/useOrderManagement.ts',
      'backend/routes/orders.js',
      'backend/routes/online-orders.js',
      'backend/routes/table-orders.js',
      'backend/routes/order-page-setups.js',
      'pos-desktop/backend/routes/orders.js',
      'pos-desktop/backend/routes/online-orders.js',
      'pos-desktop/backend/routes/table-orders.js',
      'pos-desktop/backend/routes/order-page-setups.js',
    ],
  },
  {
    key: 'menu',
    label: 'Menu Management / Menu Components / Menu API',
    env: 'ALLOW_MENU_EDITS',
    files: [
      'frontend/src/pages/MenuListPage.tsx',
      'frontend/src/pages/MenuEditPage.tsx',
      'frontend/src/pages/MenuAnalysisPage.tsx',
      'frontend/src/pages/MenuItemOptionsPage.tsx',
      'frontend/src/components/MenuGrid.tsx',
      'frontend/src/components/MenuSidebar.tsx',
      'frontend/src/components/MenuOptionsPanel.tsx',
      'frontend/src/components/MenuItemList.tsx',
      'frontend/src/components/SortableMenuItem.tsx',
      'frontend/src/components/CategorySidebar.tsx',
      'frontend/src/components/CategoryModifierConnector.tsx',
      'frontend/src/components/ModifierGroupManager.tsx',
      'frontend/src/hooks/useMenuData.ts',
      'frontend/src/contexts/MenuCacheContext.tsx',
      'frontend/src/utils/menuIdentifier.ts',
      'frontend/src/utils/menuDataFetcher.ts',
      'backend/routes/menu.js',
      'backend/routes/menus.js',
      'backend/routes/menu-sync.js',
      'backend/routes/menu-visibility.js',
      'backend/routes/menuIndependentOptions.js',
      'backend/routes/modifierGroups.js',
      'backend/routes/openPrice.js',
      'backend/routes/sold-out.js',
      'pos-desktop/backend/routes/menu.js',
      'pos-desktop/backend/routes/menus.js',
      'pos-desktop/backend/routes/menu-sync.js',
      'pos-desktop/backend/routes/menu-visibility.js',
      'pos-desktop/backend/routes/menuIndependentOptions.js',
      'pos-desktop/backend/routes/modifierGroups.js',
      'pos-desktop/backend/routes/openPrice.js',
      'pos-desktop/backend/routes/sold-out.js',
    ],
  },
  {
    key: 'tablemap',
    label: 'Table Map / Table Operations / Move-Merge',
    env: 'ALLOW_TABLEMAP_EDITS',
    files: [
      'frontend/src/pages/TableMapPage.tsx',
      'frontend/src/pages/TableMapManagerPage.tsx',
      'frontend/src/pages/TableOrderPage.tsx',
      'frontend/src/pages/TableOrderSetupPage.tsx',
      'frontend/src/pages/TableDevicesPage.tsx',
      'frontend/src/components/ProtectedTableManager.tsx',
      'frontend/src/components/reservations/TableSelectionModal.tsx',
      'frontend/src/hooks/useMoveMerge.ts',
      'frontend/src/components/MoveMergeHistoryModal.tsx',
      'frontend/src/config/tableProtection.ts',
      'backend/routes/table-map.js',
      'backend/routes/table-operations.js',
      'backend/routes/table-orders.js',
      'backend/routes/table-move-history.js',
      'pos-desktop/backend/routes/table-map.js',
      'pos-desktop/backend/routes/table-operations.js',
      'pos-desktop/backend/routes/table-orders.js',
      'pos-desktop/backend/routes/table-move-history.js',
    ],
  },
  {
    key: 'closing-report',
    label: 'Closing Report (Z-Report)',
    env: 'ALLOW_CLOSING_REPORT_EDITS',
    files: [
      'frontend/src/components/DayClosingModal.tsx',
      'backend/routes/daily-closings.js',
      'pos-desktop/backend/routes/daily-closings.js',
    ],
  },
  {
    key: 'excel-import-export',
    label: 'Excel Import/Export (Menu)',
    env: 'ALLOW_EXCEL_EDITS',
    files: [
      'backend/routes/menu.js',
      'pos-desktop/backend/routes/menu.js',
      'pos-desktop/routes/menu.js',
      'frontend/src/pages/MenuEditPage.tsx',
    ],
  },
];

function printBlockMessage(group, changedFiles) {
  console.error(`\n[protect-${group.key}] Commit blocked: ${group.label} 보호 파일이 수정되었습니다.`);
  console.error('보호 파일:');
  changedFiles.forEach(f => console.error('- ' + f));
  console.error('\n수정하려면 다음 중 하나를 수행하세요:');
  console.error(`1) 일시적으로 허용: 환경변수 ${group.env}=1 를 설정하고 커밋 (권장하지 않음)`);
  console.error(`   예) PowerShell:  $env:${group.env}='1'; git commit -m "..."; Remove-Item Env:${group.env}`);
  console.error(`   예) Bash:        ${group.env}=1 git commit -m "..."`);
  console.error('2) 별도 브랜치에서 PR로 변경하고 리뷰 필수 설정 사용 (권장)');
  console.error('3) 정말 필요한 경우에만 후킹을 수동으로 비활성화');
}

function main() {
  const staged = getStagedFiles().map(p => p.replace(/\\/g, '/'));
  let blocked = false;

  for (const group of protectedGroups) {
    const changed = group.files.filter(p => staged.includes(p));
    if (changed.length === 0) continue;

    const allowEnv = String(process.env[group.env] || '').trim();
    if (allowEnv === '1') {
      console.log(`[protect-${group.key}] Warning: ${group.label} 보호 파일이 수정되었지만 ${group.env}=1 이 설정되어 있어 계속 진행합니다.`);
      continue;
    }

    blocked = true;
    printBlockMessage(group, changed);
  }

  if (blocked) {
    process.exit(1);
  }
}

main();