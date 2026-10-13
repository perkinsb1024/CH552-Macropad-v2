/** Common HID Consumer Page (0x0C) usages. The firmware sends any 12-bit usage. */
export interface ConsumerInfo {
  usage: number;
  name: string;
  group: 'Volume' | 'Playback' | 'Display' | 'Launch' | 'Browser';
}

export const CONSUMER_USAGES: readonly ConsumerInfo[] = [
  { usage: 0xe9, name: 'Volume Up', group: 'Volume' },
  { usage: 0xea, name: 'Volume Down', group: 'Volume' },
  { usage: 0xe2, name: 'Mute', group: 'Volume' },
  { usage: 0xcd, name: 'Play / Pause', group: 'Playback' },
  { usage: 0xb0, name: 'Play', group: 'Playback' },
  { usage: 0xb1, name: 'Pause', group: 'Playback' },
  { usage: 0xb7, name: 'Stop', group: 'Playback' },
  { usage: 0xb5, name: 'Next Track', group: 'Playback' },
  { usage: 0xb6, name: 'Previous Track', group: 'Playback' },
  { usage: 0xb3, name: 'Fast Forward', group: 'Playback' },
  { usage: 0xb4, name: 'Rewind', group: 'Playback' },
  { usage: 0xb8, name: 'Eject', group: 'Playback' },
  { usage: 0x6f, name: 'Brightness Up', group: 'Display' },
  { usage: 0x70, name: 'Brightness Down', group: 'Display' },
  { usage: 0x30, name: 'Power', group: 'Display' },
  { usage: 0x32, name: 'Sleep', group: 'Display' },
  { usage: 0x192, name: 'Calculator', group: 'Launch' },
  { usage: 0x194, name: 'File Browser', group: 'Launch' },
  { usage: 0x18a, name: 'Email', group: 'Launch' },
  { usage: 0x183, name: 'Media Player', group: 'Launch' },
  { usage: 0x221, name: 'Web Search', group: 'Browser' },
  { usage: 0x223, name: 'Browser Home', group: 'Browser' },
  { usage: 0x224, name: 'Browser Back', group: 'Browser' },
  { usage: 0x225, name: 'Browser Forward', group: 'Browser' },
  { usage: 0x226, name: 'Browser Stop', group: 'Browser' },
  { usage: 0x227, name: 'Browser Refresh', group: 'Browser' },
  { usage: 0x22a, name: 'Bookmarks', group: 'Browser' },
];

const BY_USAGE = new Map(CONSUMER_USAGES.map((c) => [c.usage, c]));

export function consumerName(usage: number): string {
  return BY_USAGE.get(usage)?.name ?? `Consumer 0x${usage.toString(16).toUpperCase().padStart(3, '0')}`;
}

export const CONSUMER_GROUPS: readonly ConsumerInfo['group'][] = ['Volume', 'Playback', 'Display', 'Launch', 'Browser'];
