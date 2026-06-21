import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import { ACTIVE_ROLE } from '../lib/constants';
import { useRole } from '../lib/role-context';

// Header control that flips the UI between the client and worker contexts.
// It only renders when the user is an ACTIVE worker — otherwise there is nothing
// to switch to and we show nothing (the "Become a Worker" CTA lives elsewhere).
//
// Remember: changing activeRole only changes what the UI shows. Every database
// call still passes through RLS, so this control cannot grant any permission.
export default function RoleSwitcher() {
  const { activeRole, setActiveRole, hasActiveWorkerProfile } = useRole();

  // Guard: no active worker profile -> no toggle to show.
  if (!hasActiveWorkerProfile) return null;

  return (
    <View style={styles.container}>
      <SegmentedButtons
        value={activeRole}
        onValueChange={(value) => setActiveRole(value as typeof activeRole)}
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
  // Keep the control compact so it fits comfortably in a tab header on phones.
  container: { minWidth: 220, marginRight: 8 },
});
