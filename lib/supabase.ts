import 'react-native-url-polyfill/auto';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Read from public env vars. Only the ANON (public) key belongs in client code.
// NEVER put the service_role key here — it bypasses Row Level Security.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Guard clause: fail loudly during development if the env vars are missing,
// instead of shipping a half-configured client that errors deep in an API call.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Add EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY to your .env file (see .env.example).'
  );
}

// --- Encrypted storage adapter -------------------------------------------------
// Supabase needs somewhere to persist the auth session (access + refresh tokens)
// between app launches. On a device we store it in the OS-backed secure store
// (iOS Keychain / Android Keystore) so the tokens are ENCRYPTED at rest — never
// in plain AsyncStorage. The shape below (getItem/setItem/removeItem) is exactly
// what Supabase expects from a storage engine, typed via `SupportedStorage`.
const SecureStorageAdapter: SupportedStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

// SecureStore only exists on native. On web there is no Keychain/Keystore, so we
// hand Supabase `undefined` and it falls back to the browser's own storage.
// Guard clause keeps the platform branch flat and obvious.
const storage = Platform.OS === 'web' ? undefined : SecureStorageAdapter;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Persist the encrypted session so the user stays logged in across restarts.
    storage,
    persistSession: true,
    // Refresh the access token automatically before it expires.
    autoRefreshToken: true,
    // No URL-based session handling in a native app (that's a web/OAuth concern).
    detectSessionInUrl: false,
  },
});
