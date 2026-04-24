/// <reference types="react-scripts" />

// Electron API exposed via preload.js
interface ElectronAPI {
  getVersion: () => Promise<string>;
  quit: () => void;
  minimize: () => void;
  maximize: () => void;
  print: () => void;
  platform: string;
}

interface Web2posDemoBridge {
  isDemo: boolean;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
    web2posDemo?: Web2posDemoBridge;
    require?: any;
  }
}

export {};