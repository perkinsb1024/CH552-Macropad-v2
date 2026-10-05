// This module lives directly under src/ in development and assets/ in builds.
// Both directories are one level below the site's root, including Pages project paths.
const entryUrl = import.meta.url;

export function isLiveViewPath(path: string): boolean {
  return /\/liveView(?:\/index\.html|\/)?$/.test(path);
}

export function siteUrl(path: string, moduleUrl = entryUrl): string {
  return new URL(path, new URL('../', moduleUrl)).href;
}
