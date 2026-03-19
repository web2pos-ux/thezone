/**
 * 로컬 시스템 날짜/시간 유틸 - UTC 변환 없이 항상 로컬 시간 사용
 * Order History, 주문 생성 등 날짜 표시/저장 시 시간대 오류 방지
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** 로컬 날짜만 (YYYY-MM-DD) */
export const getLocalDateString = (d?: Date): string => {
  const date = d || new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** 로컬 날짜+시간 (YYYY-MM-DD HH:mm:ss) - DB 저장용 */
export const getLocalDatetimeString = (d?: Date): string => {
  const date = d || new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

/** 파일명용 타임스탬프 (YYYY-MM-DDTHH-mm-ss) */
export const getLocalTimestampForFilename = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
};
