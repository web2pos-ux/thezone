import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { installTableMapRetryHook } from './utils/retryQueue';
import { installPrintPreviewFetchInterceptor } from './utils/printPreviewFetchInterceptor';

try {
  installPrintPreviewFetchInterceptor();
} catch {}

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  // StrictMode 비활성화로 불필요한 이중 렌더링 방지 (개발 환경 최적화)
  <App />
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();

// Install table-map retry queue hook (safe, idempotent)
try { installTableMapRetryHook(); } catch {}
