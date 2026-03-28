export interface DeliveryChannelInfo {
  key: string;
  fullName: string;
  abbr: string;
  color: string;
  bgColor: string;
}

const DELIVERY_CHANNELS: DeliveryChannelInfo[] = [
  { key: 'ubereats', fullName: 'UberEats', abbr: 'UBER', color: 'text-green-700', bgColor: 'bg-green-100' },
  { key: 'doordash', fullName: 'DoorDash', abbr: 'DDASH', color: 'text-red-700', bgColor: 'bg-red-100' },
  { key: 'skipthedishes', fullName: 'SkipTheDishes', abbr: 'SKIP', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  { key: 'fantuan', fullName: 'Fantuan', abbr: 'FANTUAN', color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
];

const NORM_MAP: Record<string, DeliveryChannelInfo> = {};
DELIVERY_CHANNELS.forEach(ch => {
  NORM_MAP[ch.key] = ch;
  NORM_MAP[ch.fullName.toUpperCase()] = ch;
  NORM_MAP[ch.abbr] = ch;
});
NORM_MAP['UBER'] = NORM_MAP['ubereats'];
NORM_MAP['DOORDASH'] = NORM_MAP['doordash'];
NORM_MAP['DOORASH'] = NORM_MAP['doordash'];
NORM_MAP['SKIP'] = NORM_MAP['skipthedishes'];
NORM_MAP['SKIP_THE_DISHES'] = NORM_MAP['skipthedishes'];

export function getDeliveryChannelInfo(raw: string | null | undefined): DeliveryChannelInfo | null {
  if (!raw) return null;
  const key = raw.toUpperCase().replace(/\s+/g, '');
  return NORM_MAP[key] || null;
}

export function getDeliveryAbbr(raw: string | null | undefined): string {
  const info = getDeliveryChannelInfo(raw);
  return info ? info.abbr : (raw || 'DELIVERY');
}

export function getDeliveryFullName(raw: string | null | undefined): string {
  const info = getDeliveryChannelInfo(raw);
  return info ? info.fullName : (raw || 'Delivery');
}

export { DELIVERY_CHANNELS };
