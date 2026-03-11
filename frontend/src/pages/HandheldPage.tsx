/**
 * Handheld POS Page
 * POS의 SalesPage(테이블맵) + OrderPage(주문)를 그대로 사용
 * Call Server 알림은 HandheldCallOverlay (전역)로 처리
 *
 * /handheld 접속 시 → 핸드헬드 모드 활성화 후 /sales로 리다이렉트
 * 이후 테이블 선택 → /sales/order (OrderPage) 로 기존 POS 흐름 그대로 동작
 */

import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const SETUP_STORAGE_KEY = 'handheld-pos-setup';
export const HANDHELD_MODE_KEY = 'handheld-mode-active';

const HandheldPage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const savedConfig = localStorage.getItem(SETUP_STORAGE_KEY);
    if (!savedConfig) {
      navigate('/handheld-setup', { replace: true });
      return;
    }

    try {
      const parsed = JSON.parse(savedConfig);
      if (!parsed.configured) {
        navigate('/handheld-setup', { replace: true });
        return;
      }

      // 핸드헬드 모드 활성화 → HandheldCallOverlay가 감지
      localStorage.setItem(HANDHELD_MODE_KEY, JSON.stringify({
        active: true,
        posHost: parsed.posHost,
      }));

      // POS 테이블맵(SalesPage)으로 이동
      navigate('/sales', { replace: true });
    } catch {
      navigate('/handheld-setup', { replace: true });
    }
  }, [navigate]);

  return null;
};

export default HandheldPage;
