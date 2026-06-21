import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ACTIVE_ROLE } from '../../../lib/constants';
import { useRole } from '../../../lib/role-context';
import ClientHires from '../../../components/hires/ClientHires';
import WorkerHires from '../../../components/hires/WorkerHires';
import ScreenTitle from '../../../components/ui/ScreenTitle';
import { colors } from '../../../lib/theme';

// The Hires tab is role-aware: clients see the requests they SENT; workers see
// the requests they RECEIVED on their posts. Content is chosen from the UI-only
// activeRole; the database still enforces who can read/update each row.
export default function HiresTab() {
  const { activeRole } = useRole();
  const isWorker = activeRole === ACTIVE_ROLE.WORKER;

  return (
    <View style={styles.container}>
      <ScreenTitle title="Hires" />
      {isWorker ? <WorkerHires /> : <ClientHires />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
});
