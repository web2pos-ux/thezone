const path = require('path');
const { app } = require('electron');

app.whenReady().then(() => {
  const unpackedModules = path.join(app.getAppPath() + '.unpacked', 'node_modules');
  const asarModules = path.join(app.getAppPath(), 'node_modules');
  
  console.log('[TEST] app.getAppPath():', app.getAppPath());
  console.log('[TEST] unpacked path:', unpackedModules);
  console.log('[TEST] asar path:', asarModules);
  
  const fs = require('fs');
  console.log('[TEST] unpacked exists:', fs.existsSync(unpackedModules));
  
  // Set NODE_PATH
  process.env.NODE_PATH = unpackedModules + path.delimiter + asarModules;
  require('module')._initPaths();
  require('module').globalPaths.unshift(unpackedModules);
  
  // Test sqlite3
  try {
    const sqlite3 = require('sqlite3');
    console.log('[TEST] sqlite3 loaded OK!');
  } catch (e) {
    console.error('[TEST] sqlite3 FAILED:', e.message);
    console.error('[TEST] stack:', e.stack);
  }
  
  // Test canvas
  try {
    const canvas = require('canvas');
    console.log('[TEST] canvas loaded OK!');
  } catch (e) {
    console.error('[TEST] canvas FAILED:', e.message);
  }
  
  app.quit();
});
