// Client hints contain multiple brands (including Chromium and a randomized
// compatibility brand). Only recognized product names are used for display.
export function browserBrandFromHints(hints: string | null): string | null {
  const brands = new Set(Array.from((hints ?? '').slice(0, 2048).matchAll(/"([^"\\]+)"\s*;\s*v="[^"\\]*"/g), match => match[1]));
  for (const brand of ['Brave', 'Microsoft Edge', 'Opera', 'Vivaldi', 'Samsung Internet', 'Google Chrome']) {
    if (brands.has(brand)) return brand;
  }
  return null;
}

export function formatBrowserLabel(userAgent: string | null, brand?: string | null): string {
  if (brand) return brand;
  if (!userAgent) return 'Unknown browser';
  if (/Brave(?:\/|\s|$)/.test(userAgent)) return 'Brave';
  if (/SamsungBrowser\//.test(userAgent)) return 'Samsung Internet';
  if (/Vivaldi\//.test(userAgent)) return 'Vivaldi';
  if (/Edg\/|EdgiOS\/|EdgA\//.test(userAgent)) return 'Edge';
  if (/OPR\/|OPiOS\/|Opera/.test(userAgent)) return 'Opera';
  if (/Firefox\/|FxiOS\//.test(userAgent)) return 'Firefox';
  if (/CriOS\//.test(userAgent)) return 'Google Chrome';
  // Chrome/ alone is shared by several browsers; don't claim it's Google Chrome.
  if (/Chrome\//.test(userAgent)) return 'Chrome/Chromium';
  if (userAgent.includes('Safari/') && userAgent.includes('Version/')) return 'Safari';
  return 'Unknown browser';
}
