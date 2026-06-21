import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ACTIVE_ROLE } from '../../../lib/constants';
import { useRole } from '../../../lib/role-context';
import ClientFeed from '../../../components/feed/ClientFeed';
import WorkerJob from '../../../components/feed/WorkerJob';
import ScreenTitle from '../../../components/ui/ScreenTitle';
import { colors } from '../../../lib/theme';

// This tab is role-aware: the client sees the browsable "Feed", while a worker
// sees their own skill posts as the "Job" screen (tab label switches too — see
// the tabs layout). We pick the view from the UI-only activeRole; every query
// inside still goes through RLS.
export default function FeedTab() {
  const { activeRole } = useRole();
  const isWorker = activeRole === ACTIVE_ROLE.WORKER;

  return (
    <View style={styles.container}>
      <ScreenTitle title={isWorker ? 'Job' : 'Feed'} />
      {isWorker ? <WorkerJob /> : <ClientFeed />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
});
