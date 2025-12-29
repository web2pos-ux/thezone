import React from 'react';
import { useMenuCache } from '../contexts/MenuCacheContext';

export const CacheDebugger: React.FC = () => {
  const cache = useMenuCache();

  return (
    <div style={{
      position: 'fixed',
      top: 10,
      right: 10,
      background: 'rgba(0,0,0,0.8)',
      color: 'white',
      padding: '10px',
      borderRadius: '5px',
      fontSize: '12px',
      zIndex: 9999
    }}>
      <div>🔍 Cache Status</div>
      <div>isReady: {cache.isReady ? '✅' : '❌'}</div>
      <div>isLoading: {cache.isLoading ? '⏳' : '✅'}</div>
      <div>Categories: {cache.categories.length}</div>
      <div>Items: {cache.menuItems.length}</div>
      <div>Modifiers: {cache.modifierGroups.length}</div>
      <div>Last Updated: {cache.lastUpdated ? new Date(cache.lastUpdated).toLocaleTimeString() : 'Never'}</div>
      {cache.error && <div style={{color: 'red'}}>Error: {cache.error}</div>}
    </div>
  );
};

