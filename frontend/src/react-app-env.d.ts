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

declare global {
  interface Window {
    electron?: ElectronAPI;
    require?: any;
  }
}

export {};