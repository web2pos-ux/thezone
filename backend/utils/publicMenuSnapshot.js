'use strict';

const admin = require('firebase-admin');

/**
 * TZO 온라인 주문 OrderPage — `bundled: true` 단일 문서면 getDocs 4회 생략.
 * restaurants/{restaurantId}/publicMenu/snapshot
 *
 * @param {import('firebase-admin').firestore.Firestore} firestore
 * @param {string} restaurantId
 */
async function writePublicMenuSnapshot(firestore, restaurantId) {
  const restaurantRef = firestore.collection('restaurants').doc(restaurantId);

  const [catSnap, modSnap, taxSnap, itemSnap, categoryTaxLinksSnap, itemTaxLinksSnap] = await Promise.all([
    restaurantRef.collection('menuCategories').get(),
    restaurantRef.collection('modifierGroups').get(),
    restaurantRef.collection('taxGroups').get(),
    restaurantRef.collection('menuItems').get(),
    restaurantRef.collection('categoryTaxLinks').get(),
    restaurantRef.collection('itemTaxLinks').get(),
  ]);

  const categories = [];
  catSnap.forEach((d) => categories.push({ id: d.id, ...d.data() }));
  categories.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const modifierGroups = [];
  modSnap.forEach((d) => modifierGroups.push({ id: d.id, ...d.data() }));

  const taxGroups = [];
  taxSnap.forEach((d) => taxGroups.push({ id: d.id, ...d.data() }));

  const menuItems = [];
  itemSnap.forEach((d) => menuItems.push({ id: d.id, ...d.data() }));
  menuItems.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const categoryTaxLinks = [];
  categoryTaxLinksSnap.forEach((d) => categoryTaxLinks.push({ id: d.id, ...d.data() }));

  const itemTaxLinks = [];
  itemTaxLinksSnap.forEach((d) => itemTaxLinks.push({ id: d.id, ...d.data() }));

  const payload = {
    bundled: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    categories,
    modifierGroups,
    taxGroups,
    menuItems,
    categoryTaxLinks,
    itemTaxLinks,
  };

  await restaurantRef.collection('publicMenu').doc('snapshot').set(payload);

  console.log(
    `[publicMenuSnapshot] restaurants/${restaurantId}/publicMenu/snapshot — categories:${categories.length} items:${menuItems.length} mod:${modifierGroups.length} tax:${taxGroups.length} catTaxLink:${categoryTaxLinks.length} itemTaxLink:${itemTaxLinks.length}`
  );
}

module.exports = { writePublicMenuSnapshot };
