import { HID_USAGE, HID_USAGE_PAGE, REPORT_ID_REPLY, REPORT_ID_REQUEST, USB_PRODUCT_ID, USB_VENDOR_ID } from '../model/constants';

export type ReplyListener = (payload: Uint8Array) => void;

/** Minimal request/reply byte transport. Report IDs are handled by the implementation. */
export interface Transport {
  readonly name: string;
  readonly kind: 'webhid' | 'simulator';
  send(payload: Uint8Array): Promise<void>;
  onReply(listener: ReplyListener): () => void;
  onDisconnect(listener: () => void): () => void;
  close(): Promise<void>;
}

export function webHidSupported(): boolean {
  return typeof navigator !== 'undefined' && 'hid' in navigator && !!navigator.hid;
}

export class WebHidTransport implements Transport {
  readonly kind = 'webhid';
  private replyListeners = new Set<ReplyListener>();
  private disconnectListeners = new Set<() => void>();
  private readonly handleReport = (event: HIDInputReportEvent) => {
    if (event.reportId !== REPORT_ID_REPLY) return;
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    for (const listener of this.replyListeners) listener(bytes);
  };
  private readonly handleDisconnect = (event: HIDConnectionEvent) => {
    if (event.device !== this.device) return;
    for (const listener of this.disconnectListeners) listener();
  };

  private constructor(private readonly device: HIDDevice) {
    device.addEventListener('inputreport', this.handleReport);
    navigator.hid.addEventListener('disconnect', this.handleDisconnect);
  }

  get name(): string {
    return this.device.productName || 'HID device';
  }

  /** Prompts the user to choose a device exposing the vendor configuration collection. */
  static async request(): Promise<WebHidTransport | null> {
    const devices = await navigator.hid.requestDevice({
      filters: [{ vendorId: USB_VENDOR_ID, productId: USB_PRODUCT_ID, usagePage: HID_USAGE_PAGE, usage: HID_USAGE }],
    });
    const device = devices.find((d) => d.collections.some((c) => c.usagePage === HID_USAGE_PAGE && c.usage === HID_USAGE)) ?? devices[0];
    if (!device) return null;
    return WebHidTransport.open(device);
  }

  /** Reconnects to a device the user previously granted, without a chooser. */
  static async reconnectGranted(): Promise<WebHidTransport | null> {
    const devices = await navigator.hid.getDevices();
    const device = devices.find(
      (d) => d.vendorId === USB_VENDOR_ID && d.productId === USB_PRODUCT_ID && d.collections.some((c) => c.usagePage === HID_USAGE_PAGE && c.usage === HID_USAGE),
    );
    return device ? WebHidTransport.open(device) : null;
  }

  private static async open(device: HIDDevice): Promise<WebHidTransport> {
    if (!device.opened) await device.open();
    return new WebHidTransport(device);
  }

  async send(payload: Uint8Array): Promise<void> {
    await this.device.sendReport(REPORT_ID_REQUEST, new Uint8Array(payload) as Uint8Array<ArrayBuffer>);
  }

  onReply(listener: ReplyListener): () => void {
    this.replyListeners.add(listener);
    return () => this.replyListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async close(): Promise<void> {
    this.device.removeEventListener('inputreport', this.handleReport);
    navigator.hid.removeEventListener('disconnect', this.handleDisconnect);
    if (this.device.opened) await this.device.close();
  }
}
