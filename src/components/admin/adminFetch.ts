/**
 * BUG RIP - Authoritative Admin API Fetch Helper
 * 
 * Ensures all Organizer Control Center and administrative HTTP requests
 * include credentials ('include') and attach the stored admin session token
 * via the standard 'Authorization: Bearer <token>' header while preserving
 * caller-provided headers and options.
 */

export const ADMIN_TOKEN_STORAGE_KEY = 'bugrip_admin_token';

/**
 * Retrieve the stored admin session token from persistent browser storage.
 */
export function getStoredAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist the admin session token.
 */
export function setStoredAdminToken(token: string): void {
  try {
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
  } catch (e) {
    console.error('Failed to store admin session token:', e);
  }
}

/**
 * Remove the stored admin session token on logout or session expiration.
 */
export function clearStoredAdminToken(): void {
  try {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear admin session token:', e);
  }
}

/**
 * Authenticated admin fetch wrapper.
 * 
 * Guarantees:
 * - credentials: 'include' (for HttpOnly cookie compatibility)
 * - Authorization: Bearer <stored admin token> (when available)
 * - Caller-provided headers and options are preserved
 * - Safe against missing storage / token
 */
export async function adminFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const options: RequestInit = { ...init };

  // Always use credentials: 'include' for HttpOnly cookie compatibility
  options.credentials = options.credentials || 'include';

  // Normalize and merge headers preserving caller-provided ones
  const headers = new Headers(options.headers);

  // Read stored admin session token
  const token = getStoredAdminToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Ensure JSON is accepted by default so proxies and routers return JSON
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  options.headers = headers;

  return fetch(input, options);
}
