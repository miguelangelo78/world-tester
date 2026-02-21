declare module "novnc-next" {
  interface RFBOptions {
    wsProtocols?: string[];
    credentials?: { username?: string; password?: string; target?: string };
  }

  export default class RFB {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);

    viewOnly: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    background: string;

    disconnect(): void;
    sendCredentials(credentials: {
      username?: string;
      password?: string;
      target?: string;
    }): void;

    addEventListener(event: string, handler: (...args: unknown[]) => void): void;
    removeEventListener(event: string, handler: (...args: unknown[]) => void): void;
  }
}
