/* eslint-disable no-restricted-globals */
/// <reference lib="webworker" />

import { fetchMenuStructure } from '../utils/menuDataFetcher';

interface PrefetchMessage {
  type: 'prefetch';
  payload: {
    apiUrl: string;
    menuId: string;
    storeId: string;
  };
}

const ctx: DedicatedWorkerGlobalScope = self as any;

ctx.onmessage = async (event: MessageEvent<PrefetchMessage>) => {
  const data = event.data;
  if (!data || data.type !== 'prefetch') return;

  const { apiUrl, menuId, storeId } = data.payload;
  try {
    const payload = await fetchMenuStructure(apiUrl, menuId, storeId);
    ctx.postMessage({ type: 'prefetch:success', payload });
  } catch (error) {
    ctx.postMessage({
      type: 'prefetch:error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export {};

