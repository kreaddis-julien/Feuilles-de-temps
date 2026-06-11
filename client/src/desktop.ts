// Bridge to the Electron main process (exposed by electron/preload.cjs).
// All calls are no-ops when running in a plain browser.

interface DesktopAPI {
  setTrayTitle: (title: string) => void;
  closeTrayPopup: () => void;
  openMainWindow: () => void;
}

declare global {
  interface Window {
    desktopAPI?: DesktopAPI;
  }
}

export const isDesktop = typeof window !== 'undefined' && window.desktopAPI !== undefined;

export function setTrayTitle(title: string): void {
  window.desktopAPI?.setTrayTitle(title);
}

export function closeTrayPopup(): void {
  window.desktopAPI?.closeTrayPopup();
}

export function openMainWindow(): void {
  window.desktopAPI?.openMainWindow();
}
