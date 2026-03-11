import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Firebase 프로젝트 설정 (TZO와 동일한 프로젝트)
const firebaseConfig = {
  apiKey: "AIzaSyDoTjp1__dH9h5VhQaoxPCTEP_2Q7EI4d4",
  authDomain: "ezorder-platform.firebaseapp.com",
  projectId: "ezorder-platform",
  storageBucket: "ezorder-platform.firebasestorage.app",
  messagingSenderId: "717231696586",
  appId: "1:717231696586:web:f2bee9f2fef8309456a233"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);

// Firestore 인스턴스
export const firebaseDb = getFirestore(app);

export default app;
