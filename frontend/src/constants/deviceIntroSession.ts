/** Sub POS / Handheld: Intro PIN 통과 후에만 session 동안 주문 화면 진입 허용 */
export const DEVICE_INTRO_SESSION_KEY = 'pos_device_intro_unlocked';

export type DeviceIntroRole = 'sub_pos' | 'handheld';

export function getDeviceIntroSession(): DeviceIntroRole | null {
	try {
		const v = sessionStorage.getItem(DEVICE_INTRO_SESSION_KEY);
		if (v === 'sub_pos' || v === 'handheld') return v;
	} catch {
		/* ignore */
	}
	return null;
}

export function setDeviceIntroSession(role: DeviceIntroRole) {
	try {
		sessionStorage.setItem(DEVICE_INTRO_SESSION_KEY, role);
	} catch {
		/* ignore */
	}
}
