import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import type { Category, MenuItem } from '../pages/order/orderTypes';
import { fetchMenuStructure, MenuCachePayload, ModifierGroup } from '../utils/menuDataFetcher';
import { resolveMenuIdentifiers } from '../utils/menuIdentifier';

interface MenuCache {
  categories: Category[];
  menuItems: MenuItem[];
  modifierGroups: ModifierGroup[];
  isLoading: boolean;
  isReady: boolean;
  lastUpdated: number | null;
  error: string | null;
}

interface MenuCacheContextType extends MenuCache {
  refreshCache: () => Promise<void>;
  primeCache: (payload: MenuCachePayload) => void;
}

const MenuCacheContext = createContext<MenuCacheContextType | null>(null);

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177';
const CACHE_KEY = 'web2pos_menu_cache';
const CACHE_EXPIRY = 1000 * 60 * 60 * 24; // 24시간 (매우 길게)
const SOFT_EXPIRY = 1000 * 60 * 5; // 5분 (백그라운드 새로고침 기준)

interface MenuCacheProviderProps {
  children: ReactNode;
}

let inMemoryPayload: MenuCachePayload | null = null;
let inflightPayload: Promise<MenuCachePayload> | null = null;

const fetchAndRemember = async (forceRefresh = false): Promise<MenuCachePayload> => {
  if (!forceRefresh && inMemoryPayload) {
    return inMemoryPayload;
  }

  if (!inflightPayload || forceRefresh) {
    if (forceRefresh) {
      inMemoryPayload = null;
      inflightPayload = null;
    }
    const request = (async () => {
      const { storeId, menuId } = await resolveMenuIdentifiers(API_URL);
      const payload = await fetchMenuStructure(API_URL, menuId, storeId);
      inMemoryPayload = payload;
      return payload;
    })();
    inflightPayload = request.finally(() => {
      if (inflightPayload === request) {
        inflightPayload = null;
      }
    });
  }

  return inflightPayload!;
};

export const prefetchMenuCache = async (): Promise<MenuCachePayload> => {
  try {
    return await fetchAndRemember(false);
  } catch (error) {
    console.warn('prefetchMenuCache failed:', error);
    throw error;
  }
};

export const MenuCacheProvider: React.FC<MenuCacheProviderProps> = ({ children }) => {
  const [cache, setCache] = useState<MenuCache>({
    categories: [],
    menuItems: [],
    modifierGroups: [],
    isLoading: true,
    isReady: false,
    lastUpdated: null,
    error: null
  });

  // localStorage에서 캐시 로드 (Stale-While-Revalidate)
  const loadFromLocalStorage = (): { cache: MenuCache | null; shouldRefresh: boolean } => {
    try {
      console.log('🔍 Checking localStorage for cache...');
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) {
        console.log('❌ No cache found in localStorage');
        return { cache: null, shouldRefresh: false };
      }

      console.log('📦 Cache found! Parsing...');
      const data = JSON.parse(cached);
      const now = Date.now();
      const age = data.lastUpdated ? now - data.lastUpdated : Infinity;

      // 24시간 이내라면 캐시 사용 (매우 오래된 것만 거부)
      if (age < CACHE_EXPIRY) {
        const ageMinutes = Math.round(age / 1000 / 60);
        console.log(`✅ Cache is valid (${ageMinutes}min old)`);
        
        const shouldRefresh = age > SOFT_EXPIRY; // 5분 넘으면 백그라운드 갱신
        if (shouldRefresh) {
          console.log('🔄 Cache is old, will refresh in background...');
        }
        
        inMemoryPayload = {
          categories: data.categories || [],
          menuItems: data.menuItems || [],
          modifierGroups: data.modifierGroups || []
        };

        return {
          cache: {
            categories: data.categories || [],
            menuItems: data.menuItems || [],
            modifierGroups: data.modifierGroups || [],
            isLoading: false,
            isReady: true,
            lastUpdated: data.lastUpdated,
            error: null
          },
          shouldRefresh
        };
      } else {
        console.log('⏰ Cache expired (>24h old), will fetch fresh data');
        return { cache: null, shouldRefresh: false };
      }
    } catch (error) {
      console.error('❌ Failed to load cache from localStorage:', error);
      return { cache: null, shouldRefresh: false };
    }
  };

  // localStorage에 캐시 저장
  const saveToLocalStorage = (data: MenuCachePayload) => {
    try {
      const dataToSave = {
        categories: data.categories,
        menuItems: data.menuItems,
        modifierGroups: data.modifierGroups,
        lastUpdated: Date.now()
      };
      
      localStorage.setItem(CACHE_KEY, JSON.stringify(dataToSave));
      
      console.log('💾 Menu data SAVED to localStorage');
      console.log(`   📦 Categories: ${data.categories?.length || 0}`);
      console.log(`   📦 Menu Items: ${data.menuItems?.length || 0}`);
      console.log(`   📦 Modifier Groups: ${data.modifierGroups?.length || 0}`);
      inMemoryPayload = {
        categories: data.categories,
        menuItems: data.menuItems,
        modifierGroups: data.modifierGroups
      };
    } catch (error) {
      console.error('❌ Failed to save cache to localStorage:', error);
    }
  };

  const primeCache = useCallback((payload: MenuCachePayload) => {
    setCache(prev => ({
      ...prev,
      categories: payload.categories,
      menuItems: payload.menuItems,
      modifierGroups: payload.modifierGroups,
      isLoading: false,
      isReady: true,
      lastUpdated: Date.now(),
      error: null
    }));
    inMemoryPayload = payload;
    saveToLocalStorage(payload);
  }, []);

  // 서버에서 데이터 로드
  const fetchMenuData = useCallback(async (forceRefresh = false): Promise<Partial<MenuCache>> => {
    try {
      console.log('🔄 Fetching menu data from server...', { forceRefresh });
      const payload = await fetchAndRemember(forceRefresh);

      console.log(
        `✅ Loaded: ${payload.categories.length} categories, ${payload.menuItems.length} items, ${payload.modifierGroups.length} modifier groups`
      );

      return {
        categories: payload.categories,
        menuItems: payload.menuItems,
        modifierGroups: payload.modifierGroups,
        isLoading: false,
        isReady: true,
        lastUpdated: Date.now(),
        error: null
      };
    } catch (error) {
      console.error('❌ Failed to fetch menu data:', error);
      return {
        isLoading: false,
        isReady: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }, []);

  // 캐시 새로고침
  const refreshCache = useCallback(async () => {
    setCache(prev => ({ ...prev, isLoading: true }));
    const freshData = await fetchMenuData(true);

    setCache(prev => ({
      ...prev,
      ...freshData
    }));

    if (freshData.categories && freshData.menuItems && freshData.modifierGroups) {
      saveToLocalStorage({
        categories: freshData.categories,
        menuItems: freshData.menuItems,
        modifierGroups: freshData.modifierGroups
      });
    }
  }, [fetchMenuData]);

  // 초기 로드 (Stale-While-Revalidate 전략)
  useEffect(() => {
    const initialize = async () => {
      // 1. localStorage에서 먼저 로드 (즉시 표시)
      const { cache: cachedData, shouldRefresh } = loadFromLocalStorage();
      
      if (cachedData) {
        setCache(cachedData);
        
        // 캐시가 오래되었으면 백그라운드에서 새로고침
        if (shouldRefresh) {
          const freshData = await fetchMenuData(true);

          if (freshData.categories && freshData.menuItems && freshData.modifierGroups) {
            setCache(prev => ({
              ...prev,
              ...freshData
            }));
            saveToLocalStorage({
              categories: freshData.categories,
              menuItems: freshData.menuItems,
              modifierGroups: freshData.modifierGroups
            });
          }
        }
        
        return; // 캐시 사용 완료
      }

      // 2. 캐시가 없을 때만 서버에서 로드
      const freshData = await fetchMenuData();
      
      setCache(prev => ({
        ...prev,
        ...freshData
      }));

      if (freshData.categories && freshData.menuItems && freshData.modifierGroups) {
        saveToLocalStorage({
          categories: freshData.categories,
          menuItems: freshData.menuItems,
          modifierGroups: freshData.modifierGroups
        });
      }
    };

    initialize();
  }, [fetchMenuData]);

  const contextValue: MenuCacheContextType = {
    ...cache,
    refreshCache,
    primeCache
  };

  return (
    <MenuCacheContext.Provider value={contextValue}>
      {children}
    </MenuCacheContext.Provider>
  );
};

// Custom Hook
export const useMenuCache = (): MenuCacheContextType => {
  const context = useContext(MenuCacheContext);
  if (!context) {
    throw new Error('useMenuCache must be used within MenuCacheProvider');
  }
  return context;
};

