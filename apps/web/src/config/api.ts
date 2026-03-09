/**
 * Get the API base URL dynamically
 * In production (browser), uses relative URLs to the same origin
 * In development, can be configured via environment
 */
export function getApiBaseUrl(): string {
  // Browser-side: always use relative URLs to current origin
  if (typeof window !== "undefined") {
    return ""; // Empty string means relative URLs (e.g., "/api/e2e/...")
  }
  
  // Server-side (SSR/Next.js): use environment variable or localhost
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:3100";
}

/**
 * Construct full API URL
 */
export function getApiUrl(path: string): string {
  const base = getApiBaseUrl();
  if (!base) {
    // Browser side - use relative URL
    return path.startsWith("/") ? path : `/${path}`;
  }
  // Server side - use full URL
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
