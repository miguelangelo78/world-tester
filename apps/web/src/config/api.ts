/**
 * Get the API base URL dynamically
 * Supports three scenarios:
 * 1. Browser side with same-origin API: use relative URLs
 * 2. Browser side with different-origin API: use NEXT_PUBLIC_API_URL env var
 * 3. Server-side (SSR): use environment configuration
 */
export function getApiBaseUrl(): string {
  // Browser-side: check for explicit API URL config
  if (typeof window !== "undefined") {
    // Allow NEXT_PUBLIC_API_URL to override default behavior
    if (process.env.NEXT_PUBLIC_API_URL) {
      return process.env.NEXT_PUBLIC_API_URL;
    }
    // Default to same origin (relative URLs)
    return "";
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
    // Browser side with same origin - use relative URL
    return path.startsWith("/") ? path : `/${path}`;
  }
  // Use configured API base URL
  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${cleanBase}${path.startsWith("/") ? path : `/${path}`}`;
}
