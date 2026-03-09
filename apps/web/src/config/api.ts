/**
 * Get the API base URL dynamically
 * Priority:
 * 1. NEXT_PUBLIC_API_URL env var (set at build time)
 * 2. Browser: detect from current origin (for same-server deployments)
 * 3. Server: localhost:3100 (for SSR)
 */
export function getApiBaseUrl(): string {
  // If explicitly configured at build time, use that
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  
  // Browser side: use current origin (works for same-server deployments)
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  
  // Server-side (SSR): default to localhost:3100
  return "http://localhost:3100";
}

/**
 * Construct full API URL
 */
export function getApiUrl(path: string): string {
  const base = getApiBaseUrl();
  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${cleanBase}${path.startsWith("/") ? path : `/${path}`}`;
}
