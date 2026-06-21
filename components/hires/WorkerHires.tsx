import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Snackbar, Text } from 'react-native-paper';
import HireCard from './HireCard';
import StatusTabs from './StatusTabs';
import SuspendedBanner from '../SuspendedBanner';
import { HIRE_STATUS, PAGE_SIZE, QR_STAGE } from '../../lib/constants';
import {
  acceptHireRequest,
  getWorkerHires,
  rejectHireRequest,
  type HireRequest,
} from '../../lib/hires';
import { getQrSessionsForHires, type QrSession } from '../../lib/payments';
import { useRole } from '../../lib/role-context';
import { supabase } from '../../lib/supabase';
import { colors, spacing } from '../../lib/theme';

// The status filters shown as chips. 'all' is the default.
const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: HIRE_STATUS.PENDING, label: 'Pending' },
  { key: HIRE_STATUS.ACCEPTED, label: 'Accepted' },
  { key: HIRE_STATUS.IN_PROGRESS, label: 'In Progress' },
  { key: HIRE_STATUS.PAID, label: 'Paid' },
  { key: HIRE_STATUS.REJECTED, label: 'Rejected' },
];

// WORKER HIRES (Step 5): incoming requests on this worker's posts, filterable by
// status. Pending requests get Accept / Reject. Accept is one atomic UPDATE
// (the database trigger does the slot + QR + chat work).
export default function WorkerHires() {
  const router = useRouter();
  const { isWorkerSuspended } = useRole();
  const [hires, setHires] = useState<HireRequest[]>([]);
  const [qrByHire, setQrByHire] = useState<Map<string, QrSession>>(new Map());
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const filterRef = useRef(filter);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [snack, setSnack] = useState('');

  // Fetch one page (status filtered server-side). 'replace' resets the list;
  // 'append' adds the next page. QR stages are loaded for the page's in-progress
  // hires so we know when to show the "Upload Proof of Work" action (Step 8).
  const fetchPage = useCallback(async (pageToLoad: number, mode: 'replace' | 'append') => {
    const result = await getWorkerHires(pageToLoad, PAGE_SIZE, filterRef.current);
    setError(result.error);
    setHasMore(result.hasMore);
    setPage(pageToLoad);

    const inProgressIds = result.hires
      .filter((hire) => hire.status === HIRE_STATUS.IN_PROGRESS)
      .map((hire) => hire.id);
    const qrMap = await getQrSessionsForHires(inProgressIds);

    setHires((prev) => {
      const next = mode === 'append' ? [...prev, ...result.hires] : result.hires;
      const seen = new Set<string>();
      return next.filter((h) => (seen.has(h.id) ? false : seen.add(h.id)));
    });
    setQrByHire((prev) => (mode === 'append' ? new Map([...prev, ...qrMap]) : qrMap));
  }, []);

  // Initial load + reload whenever the status filter changes.
  useEffect(() => {
    filterRef.current = filter;
    (async () => {
      setLoading(true);
      await fetchPage(0, 'replace');
      setLoading(false);
    })();
  }, [filter, fetchPage]);

  const onEndReached = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    await fetchPage(page + 1, 'append');
    setLoadingMore(false);
  }, [loadingMore, loading, hasMore, page, fetchPage]);

  // Realtime: a new request or a status change refreshes the first page.
  useEffect(() => {
    const channel = supabase
      .channel(`worker-hires-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hire_requests' },
        () => fetchPage(0, 'replace')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'qr_sessions' },
        () => fetchPage(0, 'replace')
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPage]);

  async function handleAccept(hireId: string) {
    setBusyId(hireId);
    const result = await acceptHireRequest(hireId);
    setBusyId(null);
    setSnack(result.message);
    if (result.success) fetchPage(0, 'replace');
  }

  async function handleReject(hireId: string) {
    setBusyId(hireId);
    const result = await rejectHireRequest(hireId);
    setBusyId(null);
    setSnack(result.message);
    if (result.success) fetchPage(0, 'replace');
  }

  if (loading && hires.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SuspendedBanner />

      <StatusTabs filters={FILTERS} selected={filter} onSelect={setFilter} />

      <FlatList
        data={hires}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onEndReachedThreshold={0.4}
        onEndReached={onEndReached}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await fetchPage(0, 'replace');
              setRefreshing(false);
            }}
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text variant="bodyMedium">{error ?? 'No requests in this view.'}</Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator />
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const isPending = item.status === HIRE_STATUS.PENDING;
          const qr = qrByHire.get(item.id);
          // Step 8: once the client has started the job (QR at work_in_progress),
          // the worker can upload proof. After submitting, the stage moves to
          // completion_pending and we show a waiting note instead.
          const canSubmitProof =
            item.status === HIRE_STATUS.IN_PROGRESS &&
            qr?.stage === QR_STAGE.WORK_IN_PROGRESS &&
            !isWorkerSuspended;
          const proofSubmitted =
            item.status === HIRE_STATUS.IN_PROGRESS &&
            qr?.stage === QR_STAGE.COMPLETION_PENDING;
          return (
            // Client display name is not exposed by RLS, so we show a generic
            // label with a short id for reference.
            <HireCard
              title={item.post_caption ?? 'Your post'}
              subtitle={`From client #${item.client_id.slice(0, 8)}`}
              status={item.status}
            >
              {proofSubmitted ? (
                <Text variant="bodySmall" style={styles.waiting}>
                  Proof submitted. Waiting for the client to confirm completion…
                </Text>
              ) : null}
              {isPending && !isWorkerSuspended ? (
                <View style={styles.actions}>
                  <Button
                    onPress={() => handleReject(item.id)}
                    disabled={busyId === item.id}
                  >
                    Reject
                  </Button>
                  <Button
                    mode="contained"
                    onPress={() => handleAccept(item.id)}
                    loading={busyId === item.id}
                    disabled={busyId === item.id}
                  >
                    Accept
                  </Button>
                </View>
              ) : null}
              {canSubmitProof ? (
                <View style={styles.actions}>
                  <Button
                    mode="contained"
                    icon="camera"
                    onPress={() =>
                      router.push({ pathname: '/proof/[hireId]', params: { hireId: item.id } })
                    }
                  >
                    Upload Proof of Work
                  </Button>
                </View>
              ) : null}
              {item.status === HIRE_STATUS.PAID ? (
                <View style={styles.actions}>
                  <Button
                    mode="outlined"
                    icon="receipt"
                    onPress={() =>
                      router.push({ pathname: '/receipt/[hireId]', params: { hireId: item.id } })
                    }
                  >
                    View receipt
                  </Button>
                </View>
              ) : null}
            </HireCard>
          );
        }}
      />

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={2500}>
        {snack}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: 110 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  waiting: { marginTop: spacing.md, color: colors.textMuted, fontStyle: 'italic' },
  footer: { paddingVertical: spacing.lg, alignItems: 'center' },
});
