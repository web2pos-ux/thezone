/**
 * 부팅 / 온라인 복귀 시 Firestore 실시간 리스너(메뉴 가시성, DayOff, Pause, Prep) 등록.
 * 오프라인이면 빈 배열 반환(구독 없음).
 *
 * @param {import('sqlite3').Database} db
 * @param {string} restaurantId
 * @param {(rid: string, data: unknown) => void} broadcastToRestaurant
 * @returns {Array<() => void>}
 */
function registerFirebaseBootRealtimeListeners(db, restaurantId, broadcastToRestaurant) {
  const networkConnectivity = require('./networkConnectivityService');
  if (!networkConnectivity.isInternetConnected()) {
    return [];
  }
  if (!restaurantId) return [];

  const {
    listenToMenuVisibilityChanges,
    listenToDayOffChanges,
    listenToPauseChanges,
    listenToPrepTimeChanges,
  } = require('./firebaseService');
  const IdMapperService = require('./idMapperService');

  const unsubs = [];

  const unsubMenuVis = listenToMenuVisibilityChanges(restaurantId, async (change) => {
    try {
      let posItemId = await IdMapperService.firebaseToLocal('menu_item', change.firebaseItemId);

      if (!posItemId && change.itemName) {
        const posItem = await new Promise((resolve, reject) => {
          db.get(
            'SELECT item_id FROM menu_items WHERE name = ?',
            [change.itemName],
            (err, row) => (err ? reject(err) : resolve(row)),
          );
        });
        posItemId = posItem?.item_id;
      }

      if (posItemId) {
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE menu_items SET 
                    online_visible = ?, delivery_visible = ?,
                    online_hide_type = ?, online_available_until = ?,
                    delivery_hide_type = ?, delivery_available_until = ?
                  WHERE item_id = ?`,
            [
              change.onlineVisible ? 1 : 0,
              change.deliveryVisible ? 1 : 0,
              change.onlineHideType || 'visible',
              change.onlineAvailableUntil || null,
              change.deliveryHideType || 'visible',
              change.deliveryAvailableUntil || null,
              posItemId,
            ],
            (err) => (err ? reject(err) : resolve()),
          );
        });
        console.log(
          `✅ POS visibility 동기화: ${change.itemName} [${change.firebaseItemId} → ${posItemId}] (type: ${change.onlineHideType}, until: ${change.onlineAvailableUntil})`,
        );
        if (typeof broadcastToRestaurant === 'function') {
          broadcastToRestaurant(restaurantId, {
            type: 'menu_visibility_changed',
            item: {
              item_id: posItemId,
              name: change.itemName,
              online_visible: change.onlineVisible ? 1 : 0,
              delivery_visible: change.deliveryVisible ? 1 : 0,
              online_hide_type: change.onlineHideType || 'visible',
              online_available_until: change.onlineAvailableUntil,
              delivery_hide_type: change.deliveryHideType || 'visible',
              delivery_available_until: change.deliveryAvailableUntil,
            },
          });
        }
      } else {
        console.warn(`⚠️ POS visibility 동기화 건너뜀: ${change.itemName} - 매핑된 POS 아이템 없음`);
      }
    } catch (syncErr) {
      console.warn(`⚠️ POS visibility 동기화 실패: ${change.itemName}`, syncErr.message);
    }
  });
  if (typeof unsubMenuVis === 'function') unsubs.push(unsubMenuVis);
  console.log(`👂 Menu Visibility 리스너 활성화 - Firebase → POS 실시간 동기화 (IdMapper 사용)`);

  const unsubDayOff = listenToDayOffChanges(restaurantId, async (change) => {
    try {
      if (!change.dates || !Array.isArray(change.dates)) return;

      await new Promise((resolve, reject) => {
        db.run('DELETE FROM online_day_off', [], (err) => (err ? reject(err) : resolve()));
      });

      for (const dayOff of change.dates) {
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO online_day_off (date, channels, type) VALUES (?, ?, ?)',
            [dayOff.date, dayOff.channels || 'all', dayOff.scheduleType || dayOff.type || 'closed'],
            (err) => (err ? reject(err) : resolve()),
          );
        });
      }

      console.log(`✅ POS Day Off 동기화: ${change.dates.length}개 날짜 (${change.type})`);
    } catch (syncErr) {
      console.warn(`⚠️ POS Day Off 동기화 실패:`, syncErr.message);
    }
  });
  if (typeof unsubDayOff === 'function') unsubs.push(unsubDayOff);
  console.log(`👂 Day Off 리스너 활성화 - Firebase → POS 실시간 동기화`);

  const unsubPause = listenToPauseChanges(restaurantId, async (change) => {
    try {
      if (!change.settings) return;

      for (const [channel, data] of Object.entries(change.settings)) {
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO online_pause_settings (channel, paused, paused_until, updated_at) 
                   VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(channel) DO UPDATE SET 
                     paused = excluded.paused, 
                     paused_until = excluded.paused_until,
                     updated_at = CURRENT_TIMESTAMP`,
            [channel, data.paused ? 1 : 0, data.pausedUntil || null],
            (err) => (err ? reject(err) : resolve()),
          );
        });
      }

      console.log(`✅ POS Pause 동기화: ${Object.keys(change.settings).length}개 채널 (${change.type})`);
    } catch (syncErr) {
      console.warn(`⚠️ POS Pause 동기화 실패:`, syncErr.message);
    }
  });
  if (typeof unsubPause === 'function') unsubs.push(unsubPause);
  console.log(`👂 Pause 리스너 활성화 - Firebase → POS 실시간 동기화`);

  const unsubPrep = listenToPrepTimeChanges(restaurantId, async (change) => {
    try {
      if (!change.settings) return;

      for (const [channel, data] of Object.entries(change.settings)) {
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO online_prep_time_settings (channel, mode, time, updated_at) 
                   VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(channel) DO UPDATE SET 
                     mode = excluded.mode, 
                     time = excluded.time,
                     updated_at = CURRENT_TIMESTAMP`,
            [channel, data.mode || 'auto', data.time || '15'],
            (err) => (err ? reject(err) : resolve()),
          );
        });
      }

      console.log(`✅ POS Prep Time 동기화: ${Object.keys(change.settings).length}개 채널 (${change.type})`);
    } catch (syncErr) {
      console.warn(`⚠️ POS Prep Time 동기화 실패:`, syncErr.message);
    }
  });
  if (typeof unsubPrep === 'function') unsubs.push(unsubPrep);
  console.log(`👂 Prep Time 리스너 활성화 - Firebase → POS 실시간 동기화`);

  return unsubs;
}

module.exports = { registerFirebaseBootRealtimeListeners };
