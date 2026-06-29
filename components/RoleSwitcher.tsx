import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import { ACTIVE_ROLE, type ActiveRole } from '../lib/constants';
import { useRole } from '../lib/role-context';

type Props = {
  // When provided, the parent intercepts the change (e.g. to confirm via a modal
  // before switching). When omitted, the toggle switches the role immediately.
  onRequestChange?: (next: ActiveRole) => void;
};

// Control that flips the UI between the client and worker contexts. It now lives
// in the Settings (Profile) screen and only renders when the user is an ACTIVE
// worker — otherwise there is nothing to switch to and we show nothing (the
// "Become a Worker" CTA lives elsewhere).
//
// Remember: changing activeRole only changes what the UI shows. Every database
// call still passes through RLS, so this control cannot grant any permission.
export default function RoleSwitcher({ onRequestChange }: Props) {
  const { activeRole, setActiveRole, hasActiveWorkerProfile } = useRole();

  // Guard: no active worker profile -> no toggle to show.
  if (!hasActiveWorkerProfile) return null;

  return (
    <View style={styles.container}>
      <SegmentedButtons
        value={activeRole}
        onValueChange={(value) => {
          const next = value as ActiveRole;
          // Guard: tapping the role you're already in is a no-op.
          if (next === activeRole) return;
          if (onRequestChange) onRequestChange(next);
          else setActiveRole(next);
        }}
        density="small"
        buttons={[
          { value: ACTIVE_ROLE.CLIENT, label: 'Client', icon: 'account' },
          { value: ACTIVE_ROLE.WORKER, label: 'Worker', icon: 'briefcase' },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Fill the width of its container so it reads as a settings row on any phone.
  container: { width: '100%' },
});
