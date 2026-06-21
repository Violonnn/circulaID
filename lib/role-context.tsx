import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { ACCOUNT_STATUS, ACTIVE_ROLE, type ActiveRole } from './constants';
import { getWorkerProfile, type WorkerProfile } from './worker';
import { useAuth } from './auth-context';

// Where the last-used role is remembered between app launches. We reuse
// expo-secure-store (already the project's storage engine for the auth session)
// instead of pulling in AsyncStorage just for one small preference. The active
// role is a UI preference, not a secret — SecureStore simply keeps us to one
// storage approach across the codebase.
const ACTIVE_ROLE_KEY = 'circulaid.activeRole';

// On web there is no SecureStore; fall back to no-ops so the app still runs.
async function readStoredRole(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  return SecureStore.getItemAsync(ACTIVE_ROLE_KEY);
}
async function writeStoredRole(role: ActiveRole): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(ACTIVE_ROLE_KEY, role);
}

type RoleState = {
  // UI-ONLY context the user is currently viewing the app as. NEVER pass this to
  // Supabase as a stand-in for a permission check — RLS is the real gate.
  activeRole: ActiveRole;
  setActiveRole: (role: ActiveRole) => void;
  // The user's worker profile row (null if they never became a worker).
  workerProfile: WorkerProfile | null;
  // True only when a worker profile exists AND its status is 'active'. This is
  // the single guard that decides whether the client/worker toggle is shown.
  hasActiveWorkerProfile: boolean;
  // True when a worker profile exists but has been suspended by an admin. Used
  // to show a banner and disable write actions (UX only — RLS still enforces).
  isWorkerSuspended: boolean;
  // True while we're still loading the worker profile after login.
  loading: boolean;
  // Re-fetch the worker profile. Pass `activateWorkerView` to also switch the UI
  // into the worker view (used right after the become-a-worker setup flow).
  refreshWorkerProfile: (activateWorkerView?: boolean) => Promise<void>;
};

const RoleContext = createContext<RoleState>({
  activeRole: ACTIVE_ROLE.CLIENT,
  setActiveRole: () => {},
  workerProfile: null,
  hasActiveWorkerProfile: false,
  isWorkerSuspended: false,
  loading: true,
  refreshWorkerProfile: async () => {},
});

export function useRole() {
  return useContext(RoleContext);
}

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  // Default to the client context on every login (per Step 1). We override this
  // with the stored preference once it loads, if the user is still eligible.
  const [activeRole, setActiveRoleState] = useState<ActiveRole>(ACTIVE_ROLE.CLIENT);
  const [workerProfile, setWorkerProfile] = useState<WorkerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const hasActiveWorkerProfile =
    workerProfile !== null && workerProfile.status === ACCOUNT_STATUS.ACTIVE;
  const isWorkerSuspended =
    workerProfile !== null && workerProfile.status === ACCOUNT_STATUS.SUSPENDED;

  // Load the worker profile whenever the signed-in user changes.
  useEffect(() => {
    let active = true;

    async function load() {
      // Guard: signed out -> no worker profile, reset to the default client view.
      if (!session) {
        setWorkerProfile(null);
        setActiveRoleState(ACTIVE_ROLE.CLIENT);
        setLoading(false);
        return;
      }

      setLoading(true);
      const profile = await getWorkerProfile();
      if (!active) return;
      setWorkerProfile(profile);

      // Decide the starting role: honor the saved preference only if the user is
      // an ACTIVE worker; otherwise force the client view.
      const stored = await readStoredRole();
      if (!active) return;
      const canBeWorker = profile !== null && profile.status === ACCOUNT_STATUS.ACTIVE;
      const startRole =
        canBeWorker && stored === ACTIVE_ROLE.WORKER
          ? ACTIVE_ROLE.WORKER
          : ACTIVE_ROLE.CLIENT;
      setActiveRoleState(startRole);
      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  // Persist the choice so the app reopens in the last-used role. We block any
  // attempt to switch to 'worker' without an active worker profile — that's a UI
  // safety net; the database would reject worker-only writes regardless.
  function setActiveRole(role: ActiveRole) {
    if (role === ACTIVE_ROLE.WORKER && !hasActiveWorkerProfile) return;
    setActiveRoleState(role);
    // Fire-and-forget; a failed write to a UI preference shouldn't block the UI.
    writeStoredRole(role).catch(() => {});
  }

  async function refreshWorkerProfile(activateWorkerView = false) {
    const profile = await getWorkerProfile();
    setWorkerProfile(profile);
    // If the worker was just suspended (or has no profile), force the client view.
    if (profile === null || profile.status !== ACCOUNT_STATUS.ACTIVE) {
      setActiveRoleState(ACTIVE_ROLE.CLIENT);
      return;
    }
    // After the setup flow, drop a brand-new active worker straight into the
    // worker view so the Job tab + skill posting feel like one continuous flow.
    // We use the freshly-fetched profile here, so there's no stale-state race.
    if (activateWorkerView) {
      setActiveRoleState(ACTIVE_ROLE.WORKER);
      writeStoredRole(ACTIVE_ROLE.WORKER).catch(() => {});
    }
  }

  return (
    <RoleContext.Provider
      value={{
        activeRole,
        setActiveRole,
        workerProfile,
        hasActiveWorkerProfile,
        isWorkerSuspended,
        loading,
        refreshWorkerProfile,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}
