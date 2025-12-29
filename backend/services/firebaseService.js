// backend/services/firebaseService.js
// Firebase Admin SDK 초기화 및 온라인 주문 실시간 리스너

const admin = require('firebase-admin');
const path = require('path');

// 서비스 계정 키 경로
const serviceAccountPath = path.join(__dirname, '..', 'config', 'firebase-service-account.json');

let db = null;
let isInitialized = false;

// Firebase 초기화
function initializeFirebase() {
  if (isInitialized) {
    return db;
  }

  try {
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

  // pending 상태의 주문만 실시간 감지
  let isInitial = true;
  const unsubscribe = firestore
    .collection('orders')
    .where('restaurantId', '==', restaurantId)
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

// 주문 상태 변경
async function updateOrderStatus(orderId, newStatus) {
  const firestore = getFirestore();
  
  const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled', 'picked_up'];
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }

  await firestore.collection('orders').doc(orderId).update({
    status: newStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log(`✅ 주문 상태 변경: ${orderId} → ${newStatus}`);
  return { success: true, orderId, status: newStatus };
}

// 주문 수락 (pending → confirmed + prepTime/pickupTime 설정)
async function acceptOrder(orderId, prepTime, pickupTime) {
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

  await firestore.collection('orders').doc(orderId).update(updateData);

  console.log(`✅ 주문 수락: ${orderId} - Prep Time: ${prepTime}분, Pickup Time: ${pickupTime}`);
  return { success: true, orderId, status: 'confirmed', prepTime, pickupTime };
}

// 주문 목록 조회 (특정 레스토랑) - 오늘 날짜만
async function getOnlineOrders(restaurantId, options = {}) {
  const firestore = getFirestore();
  
  const { status } = options;

  // 오늘 날짜 시작 시간 (00:00:00)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = admin.firestore.Timestamp.fromDate(today);

  console.log(`[getOnlineOrders] restaurantId: "${restaurantId}", today: ${today.toISOString()}`);

  try {
    // 쿼리 빌드 - restaurantId + 오늘 날짜 필터링
    let query = firestore
      .collection('orders')
      .where('restaurantId', '==', restaurantId)
      .where('createdAt', '>=', todayTimestamp);

    // 특정 상태만 필터링 (선택적)
    if (status) {
      query = query.where('status', '==', status);
    }

    const snapshot = await query.get();
    console.log(`[getOnlineOrders] Result: ${snapshot.size} orders found (today only)`);
    
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

    console.log(`[getOnlineOrders] Orders:`, orders.map(o => `${o.id}: ${o.status}`).join(', '));

    return orders;
  } catch (error) {
    console.error('[getOnlineOrders] Error:', error.message);
    throw error;
  }
}

// 단일 주문 조회
async function getOrderById(orderId) {
  const firestore = getFirestore();
  
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

// 메뉴 카테고리 동기화 (POS → Firebase)
async function syncMenuCategories(restaurantId, categories) {
  const firestore = getFirestore();
  const batch = firestore.batch();

  for (const category of categories) {
    const ref = firestore.collection('menuCategories').doc();
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

// 메뉴 아이템 동기화 (POS → Firebase)
async function syncMenuItems(restaurantId, categoryId, items) {
  const firestore = getFirestore();
  const batch = firestore.batch();

  for (const item of items) {
    const ref = firestore.collection('menuItems').doc();
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
    
    const orderDoc = {
      restaurantId,
      orderNumber: orderData.orderNumber || orderData.order_number,
      customerName: orderData.customerName || orderData.customer_name || 'Walk-in',
      customerPhone: orderData.customerPhone || orderData.customer_phone || '',
      orderType: (orderData.orderType || orderData.order_type || 'dine_in').toLowerCase(),
      status: (orderData.status || 'pending').toLowerCase(),
      items: orderData.items || [],
      subtotal: parseFloat(orderData.subtotal) || 0,
      tax: parseFloat(orderData.tax || orderData.tax_total) || 0,
      total: parseFloat(orderData.total) || 0,
      notes: orderData.notes || orderData.customer_note || '',
      tableId: orderData.tableId || orderData.table_id || '',
      source: orderData.source || 'POS',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await firestore.collection('orders').add(orderDoc);
    console.log(`✅ 주문 업로드 완료 (Firebase ID: ${docRef.id}, Order Number: ${orderDoc.orderNumber})`);
    
    return docRef.id;
  } catch (error) {
    console.error('❌ 주문 업로드 실패:', error.message);
    // 동기화 실패가 전체 주문 프로세스를 멈추지 않도록 에러만 출력
    return null;
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
  uploadOrder
};

