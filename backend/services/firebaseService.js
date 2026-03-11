// backend/services/firebaseService.js
// Firebase Admin SDK 초기화 및 온라인 주문 실시간 리스너

const admin = require('firebase-admin');
const path = require('path');

// 서비스 계정 키 경로 (읽기 전용 파일 - 빌드 리소스에서 읽음)
// 패키징된 앱에서는 resources/backend/config에, 개발 모드에서는 backend/config에 위치
const RESOURCES_CONFIG_DIR = path.join(__dirname, '..', 'config');
const CONFIG_DIR = process.env.CONFIG_PATH || RESOURCES_CONFIG_DIR;
const serviceAccountPath = path.join(RESOURCES_CONFIG_DIR, 'firebase-service-account.json');

let db = null;
let isInitialized = false;

// Firebase 초기화
function initializeFirebase() {
  if (isInitialized && db) {
    return db;
  }

  try {
    // 이미 초기화된 앱이 있는지 확인
    if (admin.apps.length > 0) {
      console.log('🔥 Firebase Admin SDK 이미 초기화됨 - 기존 앱 재사용');
      db = admin.firestore();
      isInitialized = true;
      return db;
    }

    const serviceAccount = require(serviceAccountPath);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });

    db = admin.firestore();
    isInitialized = true;
    console.log('🔥 Firebase Admin SDK 초기화 완료');
    console.log(`📦 Project ID: ${serviceAccount.project_id}`);
    
    return db;
  } catch (error) {
    console.error('❌ Firebase 초기화 실패:', error.message);
    throw error;
  }
}

// Firestore 인스턴스 가져오기
function getFirestore() {
  if (!isInitialized) {
    initializeFirebase();
  }
  return db;
}

// 온라인 주문 실시간 리스너
// restaurantId: Firebase의 레스토랑 ID
// onNewOrder: 새 주문 콜백 함수
// onOrderUpdate: 주문 업데이트 콜백 함수
function listenToOnlineOrders(restaurantId, { onNewOrder, onOrderUpdate, onError }) {
  if (!restaurantId) {
    console.error('❌ restaurantId가 필요합니다');
    return null;
  }

  const firestore = getFirestore();
  
  console.log(`👂 온라인 주문 리스너 시작 - Restaurant ID: ${restaurantId}`);

  // pending 상태의 주문만 실시간 감지 (서브컬렉션 우선)
  let isInitial = true;
  const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
  const unsubscribe = restaurantRef
    .collection('orders')
    .where('status', '==', 'pending')
    .onSnapshot(
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const order = { id: change.doc.id, ...change.doc.data() };
          
          if (change.type === 'added') {
            // 초기 로딩 시의 added는 무시하고, 그 이후의 added만 알림 (새 주문)
            if (!isInitial) {
              console.log('🆕 새 온라인 주문 감지:', order.orderNumber);
              if (onNewOrder) onNewOrder(order);
            } else {
              console.log('📦 기존 대기 주문 로드 (알림 생략):', order.orderNumber);
            }
          } else if (change.type === 'modified') {
            console.log('📝 주문 수정:', order.orderNumber);
            if (onOrderUpdate) onOrderUpdate(order);
          }
        });
        isInitial = false;
      },
      (error) => {
        console.error('❌ 주문 리스너 오류:', error);
        if (onError) onError(error);
      }
    );

  return unsubscribe;
}

// 주문 상태 변경 (서브컬렉션 우선, 글로벌 fallback)
async function updateOrderStatus(orderId, newStatus, restaurantId = null) {
  const firestore = getFirestore();
  
  const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled', 'picked_up'];
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }

  const updateData = {
    status: newStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  // 서브컬렉션 우선 시도
  if (restaurantId) {
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    await restaurantRef.collection('orders').doc(orderId).update(updateData);
  } else {
    // fallback: 글로벌 컬렉션
    await firestore.collection('orders').doc(orderId).update(updateData);
  }

  console.log(`✅ 주문 상태 변경: ${orderId} → ${newStatus}`);
  return { success: true, orderId, status: newStatus };
}

// 주문 수락 (pending → confirmed + prepTime/pickupTime 설정)
async function acceptOrder(orderId, prepTime, pickupTime, restaurantId = null) {
  const firestore = getFirestore();
  
  const updateData = {
    status: 'confirmed',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  
  if (prepTime) {
    updateData.prepTime = prepTime;
  }
  
  if (pickupTime) {
    updateData.pickupTime = pickupTime;
  }

  // 서브컬렉션 우선 시도
  if (restaurantId) {
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    await restaurantRef.collection('orders').doc(orderId).update(updateData);
  } else {
    // fallback: 글로벌 컬렉션
    await firestore.collection('orders').doc(orderId).update(updateData);
  }

  console.log(`✅ 주문 수락: ${orderId} - Prep Time: ${prepTime}분, Pickup Time: ${pickupTime}`);
  return { success: true, orderId, status: 'confirmed', prepTime, pickupTime };
}

// 주문 목록 조회 (특정 레스토랑) - 전체
async function getOnlineOrders(restaurantId, options = {}) {
  const firestore = getFirestore();
  
  const { status } = options;

  console.log(`[getOnlineOrders] restaurantId: "${restaurantId}"`);

  try {
    // 쿼리 빌드 - 서브컬렉션 우선 사용
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    let query = restaurantRef.collection('orders');

    // 특정 상태만 필터링 (선택적)
    if (status) {
      query = query.where('status', '==', status);
    }

    const snapshot = await query.get();
    console.log(`[getOnlineOrders] Result: ${snapshot.size} orders found`);
    
    const orders = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      orders.push({ id: doc.id, ...data });
    });

    // 결과를 createdAt 기준 내림차순 정렬 (클라이언트 사이드)
    orders.sort((a, b) => {
      const aTime = a.createdAt?._seconds || 0;
      const bTime = b.createdAt?._seconds || 0;
      return bTime - aTime;
    });

    return orders;
  } catch (error) {
    console.error('[getOnlineOrders] Error:', error.message);
    throw error;
  }
}

// 단일 주문 조회 (서브컬렉션 우선, 글로벌 fallback)
async function getOrderById(orderId, restaurantId = null) {
  const firestore = getFirestore();
  
  // 서브컬렉션 우선 시도
  if (restaurantId) {
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    const doc = await restaurantRef.collection('orders').doc(orderId).get();
    if (doc.exists) {
      return { id: doc.id, ...doc.data() };
    }
  }
  
  // fallback: 글로벌 컬렉션
  const doc = await firestore.collection('orders').doc(orderId).get();
  
  if (!doc.exists) {
    return null;
  }

  return { id: doc.id, ...doc.data() };
}

// 레스토랑 정보 조회
async function getRestaurantById(restaurantId) {
  const firestore = getFirestore();
  
  const doc = await firestore.collection('restaurants').doc(restaurantId).get();
  
  if (!doc.exists) {
    return null;
  }

  return { id: doc.id, ...doc.data() };
}

// 메뉴 카테고리 동기화 (POS → Firebase 서브컬렉션)
async function syncMenuCategories(restaurantId, categories) {
  const firestore = getFirestore();
  const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
  const batch = firestore.batch();

  for (const category of categories) {
    const ref = restaurantRef.collection('menuCategories').doc();
    batch.set(ref, {
      restaurantId,
      name: category.name,
      description: category.description || '',
      sortOrder: category.sort_order || 0,
      isActive: true,
      posId: category.category_id // POS의 원본 ID 저장
    });
  }

  await batch.commit();
  console.log(`✅ ${categories.length}개 카테고리 동기화 완료`);
}

// 메뉴 아이템 동기화 (POS → Firebase 서브컬렉션)
async function syncMenuItems(restaurantId, categoryId, items) {
  const firestore = getFirestore();
  const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
  const batch = firestore.batch();

  for (const item of items) {
    const ref = restaurantRef.collection('menuItems').doc();
    batch.set(ref, {
      restaurantId,
      categoryId,
      name: item.name,
      shortName: item.short_name || '',
      description: item.description || '',
      price: parseFloat(item.price) || 0,
      imageUrl: item.image_url || '',
      isAvailable: true,
      options: [], // 추후 모디파이어 동기화
      sortOrder: item.sort_order || 0,
      posId: item.item_id, // POS의 원본 ID 저장
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  await batch.commit();
  console.log(`✅ ${items.length}개 메뉴 아이템 동기화 완료`);
}

// 주문 업로드 (POS → Firebase)
async function uploadOrder(restaurantId, orderData) {
  try {
    const firestore = getFirestore();
    
    // 필수 필드 확인
    if (!restaurantId) throw new Error('restaurantId is required');
    
    const ensureLineId = (it, idx = 0) => {
      try {
        const existing = it?.orderLineId ?? it?.order_line_id ?? it?.order_lineId ?? null;
        if (existing != null && String(existing).trim() !== '') return String(existing).trim();
      } catch {}
      const base = (it && (it.id || it.itemId || it.item_id)) ? String(it.id || it.itemId || it.item_id) : 'ITEM';
      return `POS-${base}-${Date.now()}-${Number(idx) || 0}-${Math.random().toString(36).slice(2, 8)}`;
    };
    const rawItems = Array.isArray(orderData.items) ? orderData.items : [];
    const normalizedItems = rawItems.map((it, idx) => ({
      ...it,
      orderLineId: ensureLineId(it, idx),
    }));

    const orderDoc = {
      restaurantId,
      orderNumber: orderData.orderNumber || orderData.order_number,
      customerName: orderData.customerName || orderData.customer_name || 'Walk-in',
      customerPhone: orderData.customerPhone || orderData.customer_phone || '',
      orderType: (orderData.orderType || orderData.order_type || 'dine_in').toLowerCase(),
      status: (orderData.status || 'pending').toLowerCase(),
      items: normalizedItems,
      subtotal: parseFloat(orderData.subtotal) || 0,
      tax: parseFloat(orderData.tax || orderData.tax_total) || 0,
      total: parseFloat(orderData.total) || 0,
      notes: orderData.notes || orderData.customer_note || '',
      tableId: orderData.tableId || orderData.table_id || '',
      source: orderData.source || 'POS',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Delivery 주문 추가 필드
    if (orderData.deliveryCompany) {
      orderDoc.deliveryCompany = orderData.deliveryCompany;
    }
    if (orderData.deliveryOrderNumber) {
      orderDoc.deliveryOrderNumber = orderData.deliveryOrderNumber;
    }
    if (orderData.prepTime) {
      orderDoc.prepTime = orderData.prepTime;
    }
    if (orderData.readyTimeLabel) {
      orderDoc.readyTimeLabel = orderData.readyTimeLabel;
    }

    // 서브컬렉션에 주문 저장
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    const docRef = await restaurantRef.collection('orders').add(orderDoc);
    console.log(`✅ 주문 업로드 완료 (Firebase ID: ${docRef.id}, Order Number: ${orderDoc.orderNumber})`);
    
    return docRef.id;
  } catch (error) {
    console.error('❌ 주문 업로드 실패:', error.message);
    // 동기화 실패가 전체 주문 프로세스를 멈추지 않도록 에러만 출력
    return null;
  }
}

// 레스토랑 Pause 상태 업데이트 (restaurantSettings 컬렉션 사용 - TZO 호환)
async function updateRestaurantPause(restaurantId, pauseUntil, channels = ['thezoneorder']) {
  try {
    const firestore = getFirestore();
    const settingsRef = firestore.collection('restaurantSettings').doc(restaurantId);
    
    // 기존 문서 확인
    const settingsDoc = await settingsRef.get();
    
    // pauseSettings 객체 생성
    const pauseSettings = {};
    
    // 각 채널별 pause 상태 설정
    for (const channel of channels) {
      pauseSettings[channel] = {
        paused: pauseUntil ? true : false,
        pausedUntil: pauseUntil || null
      };
    }
    
    if (settingsDoc.exists) {
      // 기존 문서가 있으면 pauseSettings만 업데이트
      const existingData = settingsDoc.data() || {};
      const existingPauseSettings = existingData.pauseSettings || {};
      
      await settingsRef.update({
        pauseSettings: { ...existingPauseSettings, ...pauseSettings },
        pauseUpdatedAt: new Date()
      });
    } else {
      // 문서가 없으면 새로 생성
      await settingsRef.set({
        restaurantId,
        pauseSettings,
        pauseUpdatedAt: new Date(),
        createdAt: new Date()
      });
    }
    
    console.log(`✅ 레스토랑 Pause 상태 업데이트 완료 (${restaurantId}):`, pauseSettings);
    return true;
  } catch (error) {
    console.error('❌ 레스토랑 Pause 상태 업데이트 실패:', error.message);
    throw error;
  }
}

// Day Off 설정 동기화 (POS → Firebase)
async function syncDayOff(restaurantId, dayOffDates) {
  try {
    const firestore = getFirestore();
    const settingsRef = firestore.collection('restaurantSettings').doc(restaurantId);
    
    // 기존 문서 확인
    const settingsDoc = await settingsRef.get();
    
    // dayOffSettings 객체 생성 - type 필드 포함
    const dayOffSettings = {
      dates: dayOffDates.map(d => ({
        date: d.date,
        channels: d.channels || 'all',
        type: d.type || 'closed',  // closed, extended, early, late
        updatedAt: new Date().toISOString()
      })),
      updatedAt: new Date()
    };
    
    if (settingsDoc.exists) {
      // 기존 문서가 있으면 dayOffSettings만 업데이트
      await settingsRef.update({
        dayOffSettings,
        dayOffUpdatedAt: new Date()
      });
    } else {
      // 문서가 없으면 새로 생성
      await settingsRef.set({
        restaurantId,
        dayOffSettings,
        dayOffUpdatedAt: new Date(),
        createdAt: new Date()
      });
    }
    
    console.log(`✅ Day Off 동기화 완료 (${restaurantId}): ${dayOffDates.length}개 날짜`);
    return true;
  } catch (error) {
    console.error('❌ Day Off 동기화 실패:', error.message);
    throw error;
  }
}

// Day Off 단일 날짜 추가 - type 필드 포함
async function addDayOff(restaurantId, date, channels = 'all', type = 'closed') {
  try {
    const firestore = getFirestore();
    const settingsRef = firestore.collection('restaurantSettings').doc(restaurantId);
    
    const settingsDoc = await settingsRef.get();
    let dayOffDates = [];
    
    if (settingsDoc.exists) {
      const data = settingsDoc.data();
      dayOffDates = data.dayOffSettings?.dates || [];
    }
    
    // 이미 존재하는 날짜인지 확인 (같은 date + channels 조합)
    const existingIndex = dayOffDates.findIndex(d => d.date === date && d.channels === channels);
    if (existingIndex >= 0) {
      // 업데이트
      dayOffDates[existingIndex] = { date, channels, type, updatedAt: new Date().toISOString() };
    } else {
      // 새로 추가
      dayOffDates.push({ date, channels, type, updatedAt: new Date().toISOString() });
    }
    
    // 날짜순 정렬
    dayOffDates.sort((a, b) => a.date.localeCompare(b.date));
    
    const dayOffSettings = {
      dates: dayOffDates,
      updatedAt: new Date()
    };
    
    if (settingsDoc.exists) {
      await settingsRef.update({ dayOffSettings, dayOffUpdatedAt: new Date() });
    } else {
      await settingsRef.set({
        restaurantId,
        dayOffSettings,
        dayOffUpdatedAt: new Date(),
        createdAt: new Date()
      });
    }
    
    console.log(`✅ Day Off 추가 완료 (${restaurantId}): ${date}, type: ${type}`);
    return true;
  } catch (error) {
    console.error('❌ Day Off 추가 실패:', error.message);
    throw error;
  }
}

// Day Off 날짜 삭제
async function removeDayOff(restaurantId, date) {
  try {
    const firestore = getFirestore();
    const settingsRef = firestore.collection('restaurantSettings').doc(restaurantId);
    
    const settingsDoc = await settingsRef.get();
    
    if (!settingsDoc.exists) {
      console.log(`[Day Off] No settings found for ${restaurantId}`);
      return true;
    }
    
    const data = settingsDoc.data();
    let dayOffDates = data.dayOffSettings?.dates || [];
    
    // 해당 날짜 제거
    dayOffDates = dayOffDates.filter(d => d.date !== date);
    
    const dayOffSettings = {
      dates: dayOffDates,
      updatedAt: new Date()
    };
    
    await settingsRef.update({ dayOffSettings, dayOffUpdatedAt: new Date() });
    
    console.log(`✅ Day Off 삭제 완료 (${restaurantId}): ${date}`);
    return true;
  } catch (error) {
    console.error('❌ Day Off 삭제 실패:', error.message);
    throw error;
  }
}

// Prep Time 설정 동기화 (POS → Firebase)
async function syncPrepTimeSettings(restaurantId, prepTimeSettings) {
  try {
    const firestore = getFirestore();
    const settingsRef = firestore.collection('restaurantSettings').doc(restaurantId);
    
    const settingsDoc = await settingsRef.get();
    
    // prepTimeSettings 저장
    const prepTimeData = {
      settings: prepTimeSettings,
      updatedAt: new Date()
    };
    
    if (settingsDoc.exists) {
      await settingsRef.update({
        prepTimeSettings: prepTimeData,
        prepTimeUpdatedAt: new Date()
      });
    } else {
      await settingsRef.set({
        restaurantId,
        prepTimeSettings: prepTimeData,
        prepTimeUpdatedAt: new Date(),
        createdAt: new Date()
      });
    }
    
    console.log(`✅ Prep Time 설정 동기화 완료 (${restaurantId}):`, prepTimeSettings);
    return true;
  } catch (error) {
    console.error('❌ Prep Time 설정 동기화 실패:', error.message);
    throw error;
  }
}

// ===== Menu Visibility 동기화 =====
// POS에서 Firebase로 메뉴 아이템 visibility 동기화
// Firebase 구조: restaurants/{restaurantId}/menuItems/{itemId}
// hide_type: 'visible' | 'permanent' | 'time_limited'
// available_until: 'HH:MM' 형식 (time_limited인 경우)
async function syncMenuItemVisibility(restaurantId, categoryId, itemId, visibilityData) {
  if (!restaurantId || !itemId) {
    throw new Error('restaurantId, itemId가 필요합니다');
  }

  const firestore = getFirestore();

  try {
    // menuItems는 별도 컬렉션 (categoryId로 연결)
    const itemRef = firestore
      .collection('restaurants')
      .doc(restaurantId)
      .collection('menuItems')
      .doc(itemId);

    // 기존 호환성: visibilityData가 boolean이면 기존 방식
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    if (typeof visibilityData === 'object') {
      // 새 방식: 세부 필드 포함
      if (visibilityData.onlineVisible !== undefined) {
        updateData.onlineVisible = visibilityData.onlineVisible;
      }
      if (visibilityData.deliveryVisible !== undefined) {
        updateData.deliveryVisible = visibilityData.deliveryVisible;
      }
      if (visibilityData.onlineHideType) {
        updateData.onlineHideType = visibilityData.onlineHideType;
      }
      if (visibilityData.onlineAvailableUntil !== undefined) {
        updateData.onlineAvailableUntil = visibilityData.onlineAvailableUntil;
      }
      if (visibilityData.deliveryHideType) {
        updateData.deliveryHideType = visibilityData.deliveryHideType;
      }
      if (visibilityData.deliveryAvailableUntil !== undefined) {
        updateData.deliveryAvailableUntil = visibilityData.deliveryAvailableUntil;
      }
    } else {
      // 기존 호환성: boolean 값
      updateData.onlineVisible = visibilityData !== false;
      updateData.deliveryVisible = arguments[4] !== false; // deliveryVisible (5번째 인자)
    }

    await itemRef.update(updateData);

    console.log(`✅ Menu visibility 동기화: ${itemId}`, updateData);
    return true;
  } catch (error) {
    console.error('❌ Menu visibility 동기화 실패:', error.message);
    throw error;
  }
}

// Firebase에서 POS로 메뉴 visibility 가져오기
async function getMenuVisibilityFromFirebase(restaurantId, categoryFirebaseId) {
  if (!restaurantId) {
    throw new Error('restaurantId가 필요합니다');
  }

  const firestore = getFirestore();

  try {
    // 카테고리 정보
    const categoriesRef = firestore
      .collection('restaurants')
      .doc(restaurantId)
      .collection('menuCategories');

    const catsSnap = await categoriesRef.orderBy('sortOrder').get();
    const categoriesMap = {};
    catsSnap.docs.forEach(doc => {
      categoriesMap[doc.id] = doc.data().name;
    });

    // 아이템은 menuItems 별도 컬렉션
    const itemsRef = firestore
      .collection('restaurants')
      .doc(restaurantId)
      .collection('menuItems');

    let itemsSnap;
    if (categoryFirebaseId) {
      // 특정 카테고리만
      itemsSnap = await itemsRef.where('categoryId', '==', categoryFirebaseId).get();
    } else {
      // 전체 아이템
      itemsSnap = await itemsRef.get();
    }

    const result = itemsSnap.docs.map(itemDoc => {
      const data = itemDoc.data();
      return {
        firebaseCategoryId: data.categoryId,
        categoryName: categoriesMap[data.categoryId] || 'Unknown',
        firebaseItemId: itemDoc.id,
        itemName: data.name,
        onlineVisible: data.onlineVisible !== false,
        deliveryVisible: data.deliveryVisible !== false
      };
    });

    console.log(`📥 Firebase에서 visibility 정보 로드: ${result.length}개 아이템`);
    return result;
  } catch (error) {
    console.error('❌ Firebase visibility 가져오기 실패:', error.message);
    throw error;
  }
}

// 카테고리 전체 아이템 visibility 업데이트
async function syncCategoryVisibility(restaurantId, categoryId, onlineVisible, deliveryVisible) {
  if (!restaurantId || !categoryId) {
    throw new Error('restaurantId와 categoryId가 필요합니다');
  }

  const firestore = getFirestore();

  try {
    // menuItems 컬렉션에서 categoryId로 필터링
    const itemsRef = firestore
      .collection('restaurants')
      .doc(restaurantId)
      .collection('menuItems');

    const itemsSnap = await itemsRef.where('categoryId', '==', categoryId).get();
    const batch = firestore.batch();

    itemsSnap.docs.forEach(itemDoc => {
      const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (typeof onlineVisible === 'boolean') updates.onlineVisible = onlineVisible;
      if (typeof deliveryVisible === 'boolean') updates.deliveryVisible = deliveryVisible;
      batch.update(itemDoc.ref, updates);
    });

    await batch.commit();
    console.log(`✅ 카테고리 ${categoryId} visibility 일괄 동기화: ${itemsSnap.size}개 아이템`);
    return itemsSnap.size;
  } catch (error) {
    console.error('❌ 카테고리 visibility 동기화 실패:', error.message);
    throw error;
  }
}

// ===== Pause 실시간 리스너 (Firebase → POS) =====
// Firebase에서 Pause 변경 감지하여 POS에 반영
function listenToPauseChanges(restaurantId, onPauseChange) {
  if (!restaurantId) {
    console.error('❌ restaurantId가 필요합니다');
    return null;
  }

  const firestore = getFirestore();
  
  console.log(`👂 Pause 리스너 시작 - Restaurant ID: ${restaurantId}`);

  const settingsRef = firestore.collection('restaurantSettings').doc(restaurantId);
  
  let isInitial = true;
  const unsubscribe = settingsRef.onSnapshot(
    (docSnap) => {
      if (!docSnap.exists) return;
      
      const data = docSnap.data();
      const pauseSettings = data.pauseSettings;
      
      if (!pauseSettings) return;
      
      if (isInitial) {
        isInitial = false;
        console.log(`📦 Pause 초기 로드: ${Object.keys(pauseSettings).length}개 채널`);
        if (onPauseChange) {
          onPauseChange({ type: 'initial', settings: pauseSettings });
        }
        return;
      }
      
      console.log(`🔄 Pause 변경 감지`);
      if (onPauseChange) {
        onPauseChange({ type: 'update', settings: pauseSettings });
      }
    },
    (error) => {
      console.error('❌ Pause 리스너 오류:', error);
    }
  );

  return unsubscribe;
}

// ===== Prep Time 실시간 리스너 (Firebase → POS) =====
// Firebase에서 Prep Time 변경 감지하여 POS에 반영
function listenToPrepTimeChanges(restaurantId, onPrepTimeChange) {
  if (!restaurantId) {
    console.error('❌ restaurantId가 필요합니다');
    return null;
  }

  const firestore = getFirestore();
  
  console.log(`👂 Prep Time 리스너 시작 - Restaurant ID: ${restaurantId}`);

  const settingsRef = firestore.collection('restaurantSettings').doc(restaurantId);
  
  let isInitial = true;
  const unsubscribe = settingsRef.onSnapshot(
    (docSnap) => {
      if (!docSnap.exists) return;
      
      const data = docSnap.data();
      const prepTimeSettings = data.prepTimeSettings;
      
      if (!prepTimeSettings) return;
      
      if (isInitial) {
        isInitial = false;
        console.log(`📦 Prep Time 초기 로드`);
        if (onPrepTimeChange) {
          onPrepTimeChange({ type: 'initial', settings: prepTimeSettings.settings || prepTimeSettings });
        }
        return;
      }
      
      console.log(`🔄 Prep Time 변경 감지`);
      if (onPrepTimeChange) {
        onPrepTimeChange({ type: 'update', settings: prepTimeSettings.settings || prepTimeSettings });
      }
    },
    (error) => {
      console.error('❌ Prep Time 리스너 오류:', error);
    }
  );

  return unsubscribe;
}

// ===== Day Off 실시간 리스너 (Firebase → POS) =====
// Firebase에서 Day Off 변경 감지하여 POS에 반영
function listenToDayOffChanges(restaurantId, onDayOffChange) {
  if (!restaurantId) {
    console.error('❌ restaurantId가 필요합니다');
    return null;
  }

  const firestore = getFirestore();
  
  console.log(`👂 Day Off 리스너 시작 - Restaurant ID: ${restaurantId}`);

  const settingsRef = firestore.collection('restaurantSettings').doc(restaurantId);
  
  let isInitial = true;
  const unsubscribe = settingsRef.onSnapshot(
    (docSnap) => {
      if (!docSnap.exists) return;
      
      const data = docSnap.data();
      const dayOffSettings = data.dayOffSettings;
      
      if (!dayOffSettings) return;
      
      if (isInitial) {
        isInitial = false;
        console.log(`📦 Day Off 초기 로드: ${dayOffSettings.dates?.length || 0}개 날짜`);
        // 초기 로드 시에도 콜백 호출하여 POS 동기화
        if (onDayOffChange && dayOffSettings.dates) {
          onDayOffChange({
            type: 'initial',
            dates: dayOffSettings.dates
          });
        }
        return;
      }
      
      // 변경 감지
      console.log(`🔄 Day Off 변경 감지: ${dayOffSettings.dates?.length || 0}개 날짜`);
      if (onDayOffChange && dayOffSettings.dates) {
        onDayOffChange({
          type: 'update',
          dates: dayOffSettings.dates
        });
      }
    },
    (error) => {
      console.error('❌ Day Off 리스너 오류:', error);
    }
  );

  return unsubscribe;
}

// ===== Menu Visibility 실시간 리스너 (Firebase → POS) =====
// Firebase에서 visibility 변경 감지하여 POS에 반영
function listenToMenuVisibilityChanges(restaurantId, onVisibilityChange) {
  if (!restaurantId) {
    console.error('❌ restaurantId가 필요합니다');
    return null;
  }

  const firestore = getFirestore();
  
  console.log(`👂 Menu Visibility 리스너 시작 - Restaurant ID: ${restaurantId}`);

  let isInitial = true;
  const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
  
  const unsubscribe = restaurantRef
    .collection('menuItems')
    .onSnapshot(
      (snapshot) => {
        if (isInitial) {
          isInitial = false;
          console.log(`📦 Menu Visibility 초기 로드: ${snapshot.size}개 아이템`);
          return;
        }
        
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'modified') {
            const item = { id: change.doc.id, ...change.doc.data() };
            
            // visibility 관련 필드가 변경된 경우에만 콜백
            const hasVisibilityFields = 'onlineVisible' in item || 'deliveryVisible' in item ||
              'onlineHideType' in item || 'deliveryHideType' in item;
            
            if (hasVisibilityFields) {
              console.log(`🔄 Menu visibility 변경 감지: ${item.name} (online: ${item.onlineVisible}, type: ${item.onlineHideType || 'visible'})`);
              if (onVisibilityChange) {
                onVisibilityChange({
                  firebaseItemId: change.doc.id,
                  itemName: item.name,
                  categoryId: item.categoryId,
                  onlineVisible: item.onlineVisible !== false,
                  deliveryVisible: item.deliveryVisible !== false,
                  onlineHideType: item.onlineHideType || 'visible',
                  onlineAvailableUntil: item.onlineAvailableUntil || null,
                  deliveryHideType: item.deliveryHideType || 'visible',
                  deliveryAvailableUntil: item.deliveryAvailableUntil || null
                });
              }
            }
          }
        });
      },
      (error) => {
        console.error('❌ Menu visibility 리스너 오류:', error);
      }
    );

  return unsubscribe;
}

// ============ Z-Report / Daily Closing 저장 ============
async function saveDailyClosing(restaurantId, closingData) {
  if (!restaurantId) {
    console.error('saveDailyClosing: restaurantId is required');
    return { success: false, error: 'Restaurant ID is required' };
  }

  try {
    const firestore = getFirestore();
    const date = closingData.date || new Date().toISOString().split('T')[0];
    
    // restaurants/{restaurantId}/dailyClosings/{date}
    const docRef = firestore
      .collection('restaurants')
      .doc(restaurantId)
      .collection('dailyClosings')
      .doc(date);

    const dataToSave = {
      ...closingData,
      date,
      updatedAt: new Date().toISOString(),
      syncedFromPOS: true
    };

    await docRef.set(dataToSave, { merge: true });
    
    console.log(`✅ Daily closing saved to Firebase: ${restaurantId}/${date}`);
    return { success: true, date };
  } catch (error) {
    console.error('saveDailyClosing error:', error);
    return { success: false, error: error.message };
  }
}

// Z-Report 조회 (Firebase에서)
async function getDailyClosing(restaurantId, date) {
  if (!restaurantId) {
    return { success: false, error: 'Restaurant ID is required' };
  }

  try {
    const firestore = getFirestore();
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    const docRef = firestore
      .collection('restaurants')
      .doc(restaurantId)
      .collection('dailyClosings')
      .doc(targetDate);

    const doc = await docRef.get();
    
    if (doc.exists) {
      return { success: true, data: doc.data() };
    } else {
      return { success: true, data: null };
    }
  } catch (error) {
    console.error('getDailyClosing error:', error);
    return { success: false, error: error.message };
  }
}

// Daily Closing 이력 조회
async function getDailyClosingHistory(restaurantId, limit = 30) {
  if (!restaurantId) {
    return { success: false, error: 'Restaurant ID is required' };
  }

  try {
    const firestore = getFirestore();
    
    const snapshot = await firestore
      .collection('restaurants')
      .doc(restaurantId)
      .collection('dailyClosings')
      .orderBy('date', 'desc')
      .limit(limit)
      .get();

    const records = [];
    snapshot.forEach(doc => {
      records.push({ id: doc.id, ...doc.data() });
    });

    return { success: true, data: records };
  } catch (error) {
    console.error('getDailyClosingHistory error:', error);
    return { success: false, error: error.message };
  }
}

// 결제 데이터 Firebase 저장
async function savePaymentToFirebase(restaurantId, paymentData) {
  if (!restaurantId) {
    console.warn('⚠️ savePaymentToFirebase: restaurantId is required');
    return { success: false, error: 'Restaurant ID is required' };
  }

  try {
    const firestore = getFirestore();
    
    // restaurants/{restaurantId}/payments/{paymentId}
    const paymentsRef = firestore
      .collection('restaurants')
      .doc(restaurantId)
      .collection('payments');

    const dataToSave = {
      ...paymentData,
      syncedFromPOS: true,
      syncedAt: new Date().toISOString()
    };

    // paymentId가 있으면 해당 문서에 저장, 없으면 자동 생성
    if (paymentData.paymentId) {
      await paymentsRef.doc(String(paymentData.paymentId)).set(dataToSave, { merge: true });
    } else {
      await paymentsRef.add(dataToSave);
    }
    
    console.log(`✅ Payment saved to Firebase: ${restaurantId}/payments/${paymentData.paymentId || 'auto'}`);
    return { success: true };
  } catch (error) {
    console.error('savePaymentToFirebase error:', error);
    return { success: false, error: error.message };
  }
}

// 팁 데이터 Firebase 저장 (tips는 sales/payments와 분리 저장)
async function saveTipToFirebase(restaurantId, tipData) {
  if (!restaurantId) {
    console.warn('⚠️ saveTipToFirebase: restaurantId is required');
    return { success: false, error: 'Restaurant ID is required' };
  }

  try {
    const firestore = getFirestore();

    // restaurants/{restaurantId}/tips/{tipId}
    const tipsRef = firestore
      .collection('restaurants')
      .doc(restaurantId)
      .collection('tips');

    const dataToSave = {
      ...tipData,
      syncedFromPOS: true,
      syncedAt: new Date().toISOString()
    };

    if (tipData.tipId) {
      await tipsRef.doc(String(tipData.tipId)).set(dataToSave, { merge: true });
    } else {
      await tipsRef.add(dataToSave);
    }

    console.log(`✅ Tip saved to Firebase: ${restaurantId}/tips/${tipData.tipId || 'auto'}`);
    return { success: true };
  } catch (error) {
    console.error('saveTipToFirebase error:', error);
    return { success: false, error: error.message };
  }
}

// 게스트 결제 상태 Firebase 저장
async function saveGuestPaymentStatus(restaurantId, orderId, guestNumber, status) {
  if (!restaurantId || !orderId) {
    console.warn('⚠️ saveGuestPaymentStatus: restaurantId and orderId are required');
    return { success: false, error: 'Restaurant ID and Order ID are required' };
  }

  try {
    const firestore = getFirestore();
    
    // restaurants/{restaurantId}/orders/{orderId}/guestPayments/{guestNumber}
    const guestRef = firestore
      .collection('restaurants')
      .doc(restaurantId)
      .collection('orders')
      .doc(String(orderId))
      .collection('guestPayments')
      .doc(String(guestNumber));

    await guestRef.set({
      guestNumber,
      status, // 'PAID', 'PARTIAL', 'UNPAID'
      updatedAt: new Date().toISOString(),
      syncedFromPOS: true
    }, { merge: true });
    
    console.log(`✅ Guest payment status saved to Firebase: order ${orderId}, guest ${guestNumber} = ${status}`);
    return { success: true };
  } catch (error) {
    console.error('saveGuestPaymentStatus error:', error);
    return { success: false, error: error.message };
  }
}

// VOID 데이터 Firebase 저장
async function saveVoidToFirebase(restaurantId, voidData) {
  if (!restaurantId) {
    console.warn('⚠️ saveVoidToFirebase: restaurantId is required');
    return { success: false, error: 'Restaurant ID is required' };
  }

  try {
    const firestore = getFirestore();
    
    // restaurants/{restaurantId}/voids/{voidId}
    const voidsRef = firestore
      .collection('restaurants')
      .doc(restaurantId)
      .collection('voids');

    const dataToSave = {
      ...voidData,
      syncedFromPOS: true,
      syncedAt: new Date().toISOString()
    };

    if (voidData.voidId) {
      await voidsRef.doc(String(voidData.voidId)).set(dataToSave, { merge: true });
    } else {
      await voidsRef.add(dataToSave);
    }
    
    console.log(`✅ Void saved to Firebase: ${restaurantId}/voids/${voidData.voidId || 'auto'}`);
    return { success: true };
  } catch (error) {
    console.error('saveVoidToFirebase error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  initializeFirebase,
  getFirestore,
  listenToOnlineOrders,
  updateOrderStatus,
  acceptOrder,
  getOnlineOrders,
  getOrderById,
  getRestaurantById,
  syncMenuCategories,
  syncMenuItems,
  uploadOrder,
  updateRestaurantPause,
  syncDayOff,
  addDayOff,
  removeDayOff,
  syncPrepTimeSettings,
  syncMenuItemVisibility,
  getMenuVisibilityFromFirebase,
  syncCategoryVisibility,
  listenToMenuVisibilityChanges,
  listenToDayOffChanges,
  listenToPauseChanges,
  listenToPrepTimeChanges,
  // Daily Closing / Z-Report
  saveDailyClosing,
  getDailyClosing,
  getDailyClosingHistory,
  // Payments
  savePaymentToFirebase,
  saveTipToFirebase,
  saveGuestPaymentStatus,
  // Voids
  saveVoidToFirebase
};

