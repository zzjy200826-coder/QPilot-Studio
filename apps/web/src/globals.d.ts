export {};

declare global {
  interface Window {
    qpilotDesktop?: {
      platform: string;
      desktopMode: boolean;
    };
  }
}
