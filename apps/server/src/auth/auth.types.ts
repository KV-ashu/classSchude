/** Identity attached to a request after JWT verification. */
export interface AuthContext {
  userId: string;
  email: string;
}

/** User representation that is safe to return over the API (never the hash). */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  college: string | null;
  timezone: string;
}

export interface AuthResult {
  user: PublicUser;
  token: string;
}