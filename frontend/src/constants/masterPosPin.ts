/** 시스템 만능 PIN — 인트로/마감/백오피스/Void·Refund 승인 등 (직원 PIN과 별도) */
export const MASTER_POS_PIN = '1126';

export function isMasterPosPin(pin: string | null | undefined): boolean {
  return String(pin || '').trim() === MASTER_POS_PIN;
}
