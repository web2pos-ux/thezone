import { API_URL } from '../config/constants';

export interface FirebasePromotion {
  id: string;
  type: 'percent_cart' | 'percent_items' | 'free_delivery' | 'bogo' | 'fixed_discount' | 'free_item';
  name: string;
  description: string;
  active: boolean;
  minOrderAmount?: number;
  discountPercent?: number;
  discountAmount?: number;
  selectedItems?: string[];
  channels: string[];
  validFrom?: string;
  validUntil?: string;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Fetch promotions from Firebase via backend
 */
export async function getFirebasePromotions(): Promise<{ promotions: FirebasePromotion[]; restaurantId?: string }> {
  try {
    const res = await fetch(`${API_URL}/api/promotions/firebase`);
    if (!res.ok) {
      console.error('Failed to fetch Firebase promotions:', res.status);
      return { promotions: [] };
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching Firebase promotions:', error);
    return { promotions: [] };
  }
}

/**
 * Sync promotions from Firebase to POS (download and save to local DB)
 */
export async function syncPromotionsFromFirebase(): Promise<{ ok: boolean; synced: number; total: number; message: string }> {
  try {
    const res = await fetch(`${API_URL}/api/promotions/sync-from-firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error('Failed to sync promotions from Firebase:', res.status, errorData);
      return { ok: false, synced: 0, total: 0, message: errorData.message || 'Sync failed' };
    }
    return await res.json();
  } catch (error) {
    console.error('Error syncing promotions from Firebase:', error);
    return { ok: false, synced: 0, total: 0, message: String(error) };
  }
}

/**
 * Sync a POS promotion to Firebase
 */
export async function syncPromotionToFirebase(promotion: any, type: 'discount' | 'free'): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/promotions/sync-to-firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promotion, type })
    });
    if (!res.ok) {
      console.error('Failed to sync promotion to Firebase:', res.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error syncing promotion to Firebase:', error);
    return false;
  }
}

/**
 * Check if a Firebase promotion applies to the current order
 */
export function checkPromotionApplicable(
  promo: FirebasePromotion,
  channel: 'table' | 'togo' | 'online' | 'delivery' | 'table-order' | 'kiosk',
  subtotal: number,
  cartItemIds: string[],
  cartItemNames?: string[]
): boolean {
  // Check if active
  if (!promo.active) return false;
  
  // Check channel - handle various channel name variations
  const channelAliases: Record<string, string[]> = {
    'table': ['dine-in', 'table', 'dinein'],
    'togo': ['togo', 'takeout', 'pick-up', 'pickup', 'to-go'],
    'online': ['online'],
    'delivery': ['delivery'],
    'table-order': ['table-order', 'tableorder'],
    'kiosk': ['kiosk']
  };
  const acceptableChannels = channelAliases[channel] || [channel];
  const hasChannel = promo.channels?.some(ch => acceptableChannels.includes(ch.toLowerCase()));
  if (!hasChannel) {
    console.log(`🎁 [Promo Check] "${promo.name}": Channel mismatch. Required: ${promo.channels?.join(',')}, Current: ${channel}`);
    return false;
  }
  
  // Check minimum order amount
  if (promo.minOrderAmount && subtotal < promo.minOrderAmount) {
    console.log(`🎁 [Promo Check] "${promo.name}": Min order not met. Required: $${promo.minOrderAmount}, Current: $${subtotal}`);
    return false;
  }
  
  // Check date validity
  const now = new Date();
  if (promo.validFrom) {
    const fromDate = new Date(promo.validFrom);
    if (now < fromDate) {
      console.log(`🎁 [Promo Check] "${promo.name}": Not yet valid. Starts: ${promo.validFrom}`);
      return false;
    }
  }
  if (promo.validUntil) {
    const untilDate = new Date(promo.validUntil);
    untilDate.setHours(23, 59, 59, 999); // Include the entire end date
    if (now > untilDate) {
      console.log(`🎁 [Promo Check] "${promo.name}": Expired. Ended: ${promo.validUntil}`);
      return false;
    }
  }
  
  // For item-specific promotions, check if any cart items match
  if (promo.type === 'percent_items' || promo.type === 'bogo' || promo.type === 'free_item') {
    const selectedItems = (promo as any).selectedItems || [];
    const selectedCategories = (promo as any).selectedCategories || []; // Item names stored here in POS
    
    if (selectedItems.length > 0 || selectedCategories.length > 0) {
      // Check by ID
      const hasMatchingById = cartItemIds.some(id => selectedItems.includes(id));
      // Check by name (selectedCategories contains item names in POS promotions)
      const hasMatchingByName = cartItemNames?.some(name => 
        selectedCategories.some((selName: string) => 
          selName.toLowerCase() === name.toLowerCase()
        )
      );
      
      if (!hasMatchingById && !hasMatchingByName) {
        console.log(`🎁 [Promo Check] "${promo.name}": No matching items. SelectedItems: ${selectedItems.join(',')}, SelectedCategories: ${selectedCategories.join(',')}, CartIDs: ${cartItemIds.join(',')}, CartNames: ${cartItemNames?.join(',')}`);
        return false;
      }
    }
  }
  
  console.log(`🎁 [Promo Check] "${promo.name}": ✅ APPLICABLE`);
  return true;
}

/**
 * Calculate discount amount for a promotion
 */
export function calculatePromotionDiscount(
  promo: FirebasePromotion,
  subtotal: number,
  cartItems: Array<{ menuItemId: string; name?: string; subtotal: number; quantity: number }>,
  deliveryFee: number = 0
): number {
  if (!promo.active) return 0;
  
  const selectedItems = (promo as any).selectedItems || [];
  const selectedCategories = (promo as any).selectedCategories || []; // Item names stored here in POS
  
  // Helper to check if item matches promotion
  const itemMatchesPromo = (item: { menuItemId: string; name?: string }) => {
    // Check by ID
    if (selectedItems.includes(item.menuItemId)) return true;
    // Check by name
    if (item.name && selectedCategories.some((selName: string) => 
      selName.toLowerCase() === item.name?.toLowerCase()
    )) return true;
    return false;
  };
  
  switch (promo.type) {
    case 'percent_cart':
      return subtotal * ((promo.discountPercent || 0) / 100);
    
    case 'percent_items':
      if (!selectedItems.length && !selectedCategories.length) return 0;
      return cartItems
        .filter(item => itemMatchesPromo(item))
        .reduce((sum, item) => sum + item.subtotal * ((promo.discountPercent || 0) / 100), 0);
    
    case 'fixed_discount':
      return Math.min(promo.discountAmount || 0, subtotal);
    
    case 'free_delivery':
      return deliveryFee;
    
    case 'bogo':
      if (!selectedItems.length && !selectedCategories.length) return 0;
      const eligibleItems = cartItems.filter(
        item => itemMatchesPromo(item) && item.quantity >= 2
      );
      if (eligibleItems.length === 0) return 0;
      const cheapest = eligibleItems.reduce((min, item) => 
        (item.subtotal / item.quantity) < (min.subtotal / min.quantity) ? item : min
      );
      return cheapest.subtotal / cheapest.quantity;
    
    case 'free_item':
      // Free item is handled separately (adding item to cart)
      return 0;
    
    default:
      return 0;
  }
}
