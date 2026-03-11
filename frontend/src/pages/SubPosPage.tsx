/**
 * Sub POS Page
 * 메인 POS와 완벽히 동일한 화면 (SalesPage + OrderPage)
 * + Call Server 알림 오버레이
 *
 * 흐름:
 *   /sub-pos → Sub POS 모드 활성화 → /sales 리다이렉트
 *   이후 SalesPage(테이블맵), OrderPage(주문), PaymentModal(결제) 등
 *   모든 기능이 메인 POS와 동일하게 동작
 *   데이터는 메인 POS의 DB에 저장
 */

import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const SETUP_STORAGE_KEY = 'sub-pos-setup';
export const SUB_POS_MODE_KEY = 'sub-pos-mode-active';

interface SetupConfig {
  posHost: string;
  deviceName: string;
  deviceId: string;
  printerEnabled: boolean;
  configured: boolean;
}

const SubPosPage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const savedConfig = localStorage.getItem(SETUP_STORAGE_KEY);
    if (!savedConfig) {
      navigate('/sub-pos-setup', { replace: true });
      return;
    }

    try {
      const parsed: SetupConfig = JSON.parse(savedConfig);
      if (!parsed.configured) {
        navigate('/sub-pos-setup', { replace: true });
        return;
      }

      // Sub POS 모드 활성화 → HandheldCallOverlay가 감지
      localStorage.setItem(SUB_POS_MODE_KEY, JSON.stringify({
        active: true,
        posHost: parsed.posHost,
        deviceName: parsed.deviceName,
        deviceId: parsed.deviceId,
      }));

      // 핸드헬드 모드도 활성화 (Call Server 오버레이 공유)
      localStorage.setItem('handheld-mode-active', JSON.stringify({
        active: true,
        posHost: parsed.posHost,
      }));

      // POS 테이블맵(SalesPage)으로 이동
      navigate('/sales', { replace: true });
    } catch {
      navigate('/sub-pos-setup', { replace: true });
    }
  }, [navigate]);

  return null;
};

export default SubPosPage;
