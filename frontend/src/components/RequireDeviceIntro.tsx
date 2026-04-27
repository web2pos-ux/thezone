import React, { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { DeviceIntroRole } from '../constants/deviceIntroSession';
import { getDeviceIntroSession } from '../constants/deviceIntroSession';

/** Sub POS·핸드헬드 주문/설정 화면: 같은 브라우저 세션에서 Intro PIN을 통과한 뒤에만 접근 */
const RequireDeviceIntro: React.FC<{ role: DeviceIntroRole }> = ({ role }) => {
	const navigate = useNavigate();
	const location = useLocation();
	const [ready, setReady] = useState(false);

	useEffect(() => {
		if (getDeviceIntroSession() === role) {
			setReady(true);
			return;
		}
		const target = role === 'handheld' ? '/intro/handheld' : '/intro/sub-pos';
		navigate(target, {
			replace: true,
			state: { from: `${location.pathname}${location.search || ''}` },
		});
	}, [role, navigate, location.pathname, location.search]);

	if (!ready) {
		return (
			<div className="flex items-center justify-center h-screen bg-slate-100">
				<div className="text-slate-600 font-medium">Checking staff sign-in…</div>
			</div>
		);
	}

	return <Outlet />;
};

export default RequireDeviceIntro;
