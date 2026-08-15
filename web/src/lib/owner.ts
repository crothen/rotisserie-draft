import type { User } from 'firebase/auth';

// SHA-256 of the site owner's email — identifies the owner in public
// code without publishing the address itself.
export const OWNER_HASH = '91fa8e4aaa27cba1007cef4cce055e11b2b60e9c651effd795a8a6f5a9a82fc8';

export async function checkOwner(user: User | null): Promise<boolean> {
  if (!user?.email || !crypto?.subtle) return false;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(user.email.toLowerCase()));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === OWNER_HASH;
}
