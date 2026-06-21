import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Dialog,
  Divider,
  IconButton,
  Portal,
  Snackbar,
  Text,
  TextInput,
} from 'react-native-paper';
import PlaceholderImage from '../PlaceholderImage';
import SuspendedBanner from '../SuspendedBanner';
import { formatDateTime, formatPeso, toTitleCase } from '../../lib/format';
import {
  acceptRequest,
  declineRequest,
  getRequestsForPosts,
  type PendingHireRequest,
} from '../../lib/hireRequests';
import { supabase } from '../../lib/supabase';
import { useRole } from '../../lib/role-context';
import { deleteWorkerPost, fetchWorkerPosts, MAX_ACTIVE_POSTS, type WorkerPost } from '../../lib/workerPosts';
import { colors, radius, shadow, spacing } from '../../lib/theme';

// WORKER "JOB" TAB. Lists the worker's OWN skill posts. Each card now contains
// its incoming hire requests INLINE (no separate screen): tap "Requests" to
// expand and Accept/Decline right there. Accepting opens the locked job chat.
// This view only renders in the worker role (see feed.tsx), so a worker viewing
// the app as a client never sees their clients here.
export default function WorkerJob() {
  const router = useRouter();
  const { isWorkerSuspended } = useRole();
  const [posts, setPosts] = useState<WorkerPost[]>([]);
  const [requestsByPost, setRequestsByPost] = useState<Map<string, PendingHireRequest[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snack, setSnack] = useState('');
  // The post pending a delete-confirmation dialog (null when none open).
  const [deleteTarget, setDeleteTarget] = useState<WorkerPost | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchWorkerPosts();
    setPosts(result.posts);
    setError(result.error);
    const requests = await getRequestsForPosts(result.posts.map((post) => post.id));
    setRequestsByPost(requests);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Realtime: a new/updated request refreshes the inline lists live. The topic
  // name is unique per mount so a remount can never grab a previous, still-active
  // channel (which would throw "cannot add callbacks after subscribe()").
  useEffect(() => {
    const channel = supabase
      .channel(`worker-job-requests-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hire_requests' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const activeCount = posts.filter((post) => post.status === 'active').length;
  const atLimit = activeCount >= MAX_ACTIVE_POSTS;
  const canCreate = !atLimit && !isWorkerSuspended;

  function toggleExpand(postId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  async function handleAccept(hireId: string, postTitle: string) {
    setBusyId(hireId);
    const result = await acceptRequest(hireId);
    setBusyId(null);
    if (!result.success) {
      setSnack(result.message);
      return;
    }
    setSnack('Accepted!');
    await load();
    // Open the locked job chat the accept created.
    if (result.threadId) {
      router.push({
        pathname: '/chat/[threadId]',
        params: { threadId: result.threadId, title: postTitle },
      });
    }
  }

  async function handleDecline(hireId: string, reason?: string) {
    setBusyId(hireId);
    const result = await declineRequest(hireId, reason);
    setBusyId(null);
    setSnack(result.message);
    if (result.success) load();
  }

  // Soft-delete after the confirmation dialog. The RPC re-checks ownership and
  // blocks if the post still has active hires, so we just surface the result.
  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteWorkerPost(deleteTarget.id);
    setDeleting(false);
    setDeleteTarget(null);
    setSnack(result.message);
    if (result.success) load();
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SuspendedBanner />
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
        ListHeaderComponent={
          <Button
            mode="contained"
            icon="plus"
            onPress={() => router.push('/skill-post-create')}
            disabled={!canCreate}
            style={styles.createButton}
            contentStyle={styles.createContent}
          >
            {atLimit ? 'Maximum of 3 active posts' : 'Create New Post'}
          </Button>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="bodyMedium">
              {error ?? 'No skill posts yet. Tap "Create New Post" to add one.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const requests = requestsByPost.get(item.id) ?? [];
          const isOpen = expanded.has(item.id);
          return (
            <Card style={styles.card} mode="elevated">
              <Card.Content>
                {/* Delete (soft) action — confirmation dialog first, never a
                    one-tap delete. Sits above the tappable body. */}
                <IconButton
                  icon="trash-can-outline"
                  size={20}
                  iconColor={colors.danger}
                  onPress={() => setDeleteTarget(item)}
                  style={styles.deleteButton}
                  accessibilityLabel="Delete post"
                />
                {/* Tapping the post body opens its detail view. */}
                <Pressable
                  style={styles.headerPressable}
                  onPress={() =>
                    router.push({ pathname: '/worker-post/[id]', params: { id: item.id } })
                  }
                >
                  <Text variant="titleMedium" style={styles.title} numberOfLines={2}>
                    {item.ai_title}
                  </Text>
                  <Text variant="bodyMedium" style={styles.summary} numberOfLines={2}>
                    {item.ai_short_description}
                  </Text>
                  <View style={styles.metaRow}>
                    <View style={styles.metaItem}>
                      <Ionicons name="people-outline" size={14} color={colors.textMuted} />
                      <Text variant="bodySmall" style={styles.meta}>
                        {item.slots_filled}/{item.total_slots} filled
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Ionicons name="pricetag-outline" size={14} color={colors.primaryAccent} />
                      <Text variant="bodySmall" style={styles.meta}>
                        {formatPeso(item.pricing_rate)}
                      </Text>
                    </View>
                  </View>
                </Pressable>

                <Divider style={styles.divider} />

                {/* Inline requests toggle — replaces the old separate screen. */}
                <Button
                  mode={requests.length ? 'contained-tonal' : 'text'}
                  icon={isOpen ? 'chevron-up' : 'account-clock-outline'}
                  onPress={() => toggleExpand(item.id)}
                  style={styles.requestsButton}
                  contentStyle={styles.requestsContent}
                >
                  {requests.length
                    ? `${requests.length} pending request${requests.length === 1 ? '' : 's'}`
                    : 'No pending requests'}
                </Button>

                {isOpen && requests.length > 0 ? (
                  <View style={styles.requestList}>
                    {requests.map((request) => (
                      <RequestRow
                        key={request.id}
                        request={request}
                        busy={busyId === request.id}
                        onAccept={() => handleAccept(request.id, item.ai_title)}
                        onDecline={(reason) => handleDecline(request.id, reason)}
                      />
                    ))}
                  </View>
                ) : null}
              </Card.Content>
            </Card>
          );
        }}
      />

      {/* Delete confirmation — destructive Delete styled with the app's danger
          color, matching the "Delete account" dialog on the profile screen. */}
      <Portal>
        <Dialog visible={!!deleteTarget} onDismiss={() => !deleting && setDeleteTarget(null)}>
          <Dialog.Title>Delete this post?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">This cannot be undone.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              mode="contained"
              buttonColor={colors.danger}
              onPress={handleConfirmDelete}
              loading={deleting}
              disabled={deleting}
            >
              Delete
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Lifted to sit just ABOVE the floating bottom nav bar so it never covers
          the "Post deleted." confirmation. */}
      <Snackbar
        visible={!!snack}
        onDismiss={() => setSnack('')}
        duration={2500}
        wrapperStyle={styles.snackbarWrapper}
      >
        {snack}
      </Snackbar>
    </View>
  );
}

// One incoming request inside a post card. Shows the CLIENT's real name + a short
// id, the schedule, location and details. Holds its own decline-reason draft so
// the optional reason field only appears for the row being declined.
function RequestRow({
  request,
  busy,
  onAccept,
  onDecline,
}: {
  request: PendingHireRequest;
  busy: boolean;
  onAccept: () => void;
  onDecline: (reason?: string) => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  const clientName = request.client_name ? toTitleCase(request.client_name) : 'Client';
  const clientId = `#${request.client_id.slice(0, 8)}`;

  return (
    <View style={styles.requestRow}>
      <View style={styles.clientRow}>
        <PlaceholderImage
          label={initials(request.client_name) || request.client_id.slice(0, 2).toUpperCase()}
          uri={request.client_avatar_url}
          width={40}
          height={40}
          borderRadius={20}
        />
        <View style={styles.clientInfo}>
          <Text variant="titleSmall" style={styles.clientName} numberOfLines={1}>
            {clientName}
          </Text>
          <Text variant="bodySmall" style={styles.clientId}>
            {clientId}
          </Text>
        </View>
      </View>

      <Detail icon="location-outline" text={request.client_location ?? 'No location given'} />
      <Detail icon="calendar-outline" text={formatDateTime(request.scheduled_at) || 'No date set'} />
      {request.details ? <Detail icon="reader-outline" text={request.details} /> : null}

      {declining ? (
        <View style={styles.declineBox}>
          <TextInput
            mode="outlined"
            label="Reason (optional)"
            value={reason}
            onChangeText={setReason}
            maxLength={200}
            multiline
            style={styles.reasonInput}
          />
          <View style={styles.actions}>
            <Button onPress={() => setDeclining(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              mode="contained"
              buttonColor={colors.danger}
              onPress={() => onDecline(reason)}
              loading={busy}
              disabled={busy}
            >
              Confirm decline
            </Button>
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button onPress={() => setDeclining(true)} disabled={busy}>
            Decline
          </Button>
          <Button mode="contained" onPress={onAccept} loading={busy} disabled={busy}>
            Accept
          </Button>
        </View>
      )}
    </View>
  );
}

function Detail({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={15} color={colors.textMuted} style={styles.detailIcon} />
      <Text variant="bodySmall" style={styles.detailText}>
        {text}
      </Text>
    </View>
  );
}

function initials(name: string | null): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: 130 },
  createButton: { borderRadius: radius.pill, marginBottom: spacing.md },
  createContent: { paddingVertical: spacing.xs },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  card: { marginBottom: spacing.xs, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.card },
  deleteButton: { position: 'absolute', top: -spacing.xs, right: -spacing.xs, margin: 0, zIndex: 2 },
  // Lift the Snackbar above the floating bottom nav bar (which floats ~92px up).
  snackbarWrapper: { bottom: 104 },
  headerPressable: { paddingRight: spacing.xl },
  title: { fontWeight: '700' },
  summary: { color: colors.textMuted, marginTop: spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  meta: { color: colors.textMuted },
  divider: { marginVertical: spacing.md, backgroundColor: colors.border },
  requestsButton: { borderRadius: radius.pill },
  requestsContent: { paddingVertical: spacing.xs },
  requestList: { marginTop: spacing.md, gap: spacing.md },
  requestRow: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  clientInfo: { flex: 1 },
  clientName: { color: colors.primary, fontWeight: '700' },
  clientId: { color: colors.textFaint },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: 2 },
  detailIcon: { marginTop: 3 },
  detailText: { flex: 1, color: colors.text },
  declineBox: { marginTop: spacing.sm },
  reasonInput: { backgroundColor: colors.surface },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
});
