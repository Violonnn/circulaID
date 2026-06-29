import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, IconButton, Surface, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import ImageViewerModal from '../../../components/ImageViewerModal';
import KeyboardAvoider from '../../../components/ui/KeyboardAvoider';
import PinnedJobPanel from '../../../components/PinnedJobPanel';
import PaymentPanel from '../../../components/chat/PaymentPanel';
import { getMessages, sendMessage, type Message } from '../../../lib/chat';
import { getHireContextByThread, type HireContext } from '../../../lib/hireRequests';
import { supabase } from '../../../lib/supabase';
import { colors, radius, spacing } from '../../../lib/theme';

// After a job is completed, the chat stays VIEWABLE forever but messaging is
// only open for this many days past completion; after that it becomes read-only.
const CHAT_GRACE_DAYS = 3;
const CHAT_GRACE_MS = CHAT_GRACE_DAYS * 24 * 60 * 60 * 1000;

// CHAT THREAD (Step 7): a standard message list + input. Messages stream live
// via a realtime subscription filtered to this thread_id. Sending validates that
// the message is not empty before inserting.
export default function ChatThread() {
  const { threadId, title } = useLocalSearchParams<{ threadId: string; title?: string }>();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [context, setContext] = useState<HireContext | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The photo currently open in the full-screen zoomable viewer (null = closed).
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  const load = useCallback(async () => {
    // Guard: no thread id means nothing to show.
    if (!threadId) {
      setError('This chat could not be found.');
      setLoading(false);
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    setCurrentUserId(auth.user?.id ?? null);

    const [result, ctx] = await Promise.all([
      getMessages(threadId),
      getHireContextByThread(threadId),
    ]);
    setMessages(result.messages);
    setContext(ctx);
    setError(result.error);
    setLoading(false);
  }, [threadId]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: new messages on THIS thread append live. We refetch on any change
  // to keep ordering simple and correct.
  useEffect(() => {
    if (!threadId) return;
    const channel = supabase
      .channel(`messages-${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          setMessages((prev) => {
            const next = payload.new as Message;
            // Guard: ignore a duplicate if we already have it (e.g. our own send).
            if (prev.some((m) => m.id === next.id)) return prev;
            return [...prev, next];
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId]);

  // Post-completion window: a completed (paid) hire sets completed_at, which
  // starts a 3-day messaging window. After it, the chat is view-only.
  const completedAt = context?.completed_at ? new Date(context.completed_at).getTime() : null;
  const closesAt = completedAt !== null ? completedAt + CHAT_GRACE_MS : null;
  const chatClosed = closesAt !== null && Date.now() > closesAt;
  const daysLeft =
    closesAt !== null ? Math.max(0, Math.ceil((closesAt - Date.now()) / (24 * 60 * 60 * 1000))) : 0;

  async function handleSend() {
    // Guard: no sending once the post-completion window has closed.
    if (chatClosed) return;
    // Guard: don't send empty/whitespace-only messages.
    if (!draft.trim() || !threadId) return;
    setSending(true);
    const result = await sendMessage(threadId, draft);
    setSending(false);
    // Guard: keep the draft if the send failed so the user doesn't lose it.
    if (!result.success) {
      setError(result.message);
      return;
    }
    setDraft('');
    // The realtime INSERT will append the message for us.
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: title || 'Chat',
          // Report action — icon + label only (no functionality yet).
          headerRight: () => (
            <Pressable
              onPress={() => {}}
              style={styles.reportButton}
              accessibilityRole="button"
              accessibilityLabel="Report this chat"
            >
              <Ionicons name="flag-outline" size={16} color={colors.danger} />
              <Text style={styles.reportLabel}>Report</Text>
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoider style={styles.flex}>
        {/* Post-completion notice: warns the window is closing, then that it's
            closed (view-only). */}
        {completedAt !== null ? (
          <View style={styles.noticeBar}>
            <Ionicons
              name={chatClosed ? 'lock-closed-outline' : 'time-outline'}
              size={15}
              color={colors.primary}
            />
            <Text style={styles.noticeText}>
              {chatClosed
                ? 'This chat is closed. You can still view past messages, but can no longer send any.'
                : `Job completed — this chat closes on ${formatDate(
                    closesAt as number
                  )} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left to message).`}
            </Text>
          </View>
        ) : null}
        {/* Toggleable, read-only job context: makes clear this chat is scoped to
            ONE hire. Collapsed by default; tap to see schedule/location/details. */}
        <PinnedJobPanel context={context} />

        {/* Negotiated SIMULATED payment: worker sends a final price, the client
            pays (Pay Now button OR scanning the worker's QR) to hold it in
            escrow, the worker marks the job done with a photo, and the client
            confirms to release it. After release the client is sent to the
            rating screen. All money here is fake test data. */}
        {threadId ? (
          <PaymentPanel
            threadId={threadId}
            onReleased={(hireRequestId) =>
              router.push({ pathname: '/rating/[hireId]', params: { hireId: hireRequestId } })
            }
          />
        ) : null}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="bodyMedium">
                {error ?? 'No messages yet. Say hello!'}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            // System notes (price sent, payment held, etc.) are centered flow
            // markers, not chat bubbles.
            if (item.kind === 'system') {
              return (
                <View style={styles.systemWrap}>
                  <Text style={styles.systemText}>
                    {systemMessageText(item.content, item.sender_id, currentUserId)}
                  </Text>
                </View>
              );
            }
            const mine = item.sender_id === currentUserId;
            return (
              <Surface
                style={[styles.bubble, mine ? styles.mine : styles.theirs]}
                elevation={1}
              >
                {/* Image attachments (e.g. the worker's "done" photo). Tap to
                    open the full-screen, pinch-to-zoom viewer (both sides). */}
                {item.kind === 'image' && item.attachment_url ? (
                  <Pressable
                    onPress={() => setViewerUri(item.attachment_url)}
                    accessibilityRole="imagebutton"
                    accessibilityLabel="View photo"
                  >
                    <Image source={{ uri: item.attachment_url }} style={styles.attachment} />
                  </Pressable>
                ) : (
                  <Text style={mine ? styles.mineText : styles.theirsText}>
                    {item.content}
                  </Text>
                )}
                <View style={styles.metaRow}>
                  <Text
                    style={[styles.time, mine ? styles.mineMeta : styles.theirsMeta]}
                  >
                    {formatTime(item.created_at)}
                  </Text>
                  {/* "Sent" only — there is no read_at on messages yet, so a read
                      receipt would be fake. See TODO in ConversationRow. */}
                  {mine ? (
                    <Ionicons name="checkmark" size={14} color={colors.primarySoft} />
                  ) : null}
                </View>
              </Surface>
            );
          }}
        />

        {chatClosed ? (
          <View style={styles.closedRow}>
            <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
            <Text style={styles.closedText}>Messaging is closed for this chat.</Text>
          </View>
        ) : (
          <View style={styles.inputRow}>
            <TextInput
              mode="outlined"
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message…"
              style={styles.input}
              outlineStyle={styles.inputOutline}
              multiline
            />
            <IconButton
              icon="send"
              mode="contained"
              onPress={handleSend}
              loading={sending}
              disabled={sending || !draft.trim()}
            />
          </View>
        )}
      </KeyboardAvoider>

      {/* Full-screen, pinch-to-zoom photo viewer for tapped image messages. */}
      <ImageViewerModal
        visible={viewerUri !== null}
        uri={viewerUri}
        onClose={() => setViewerUri(null)}
      />
    </SafeAreaView>
  );
}

// System notes are author-agnostic in the database (e.g. "Worker proposed ₱500
// for this job."). When the viewer IS the author of a price proposal, show it in
// the first person ("You proposed …") instead. Display-only: uses the sender_id
// already on the message and the currentUserId already in scope.
function systemMessageText(
  content: string,
  senderId: string,
  currentUserId: string | null
): string {
  // Guard: without a known viewer we can't personalize — show the original.
  if (!currentUserId) return content;
  if (senderId === currentUserId && content.startsWith('Worker proposed ')) {
    return `You${content.slice('Worker'.length)}`;
  }
  return content;
}

// Local, lib-free time formatter (e.g. "3:07 PM"). Falls back to empty on a bad
// timestamp so a bubble never crashes the list.
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Short date (e.g. "Jun 25, 2026") from a millisecond timestamp, for the
// chat-closing notice.
function formatDate(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  list: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  bubble: { maxWidth: '80%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    borderBottomRightRadius: 4,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    borderBottomLeftRadius: 4,
  },
  mineText: { color: colors.onPrimary },
  theirsText: { color: colors.text },
  attachment: { width: 200, height: 200, borderRadius: radius.md, backgroundColor: colors.surface },
  systemWrap: { alignItems: 'center', paddingVertical: spacing.xs },
  systemText: {
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: 12,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 3,
    marginTop: 3,
  },
  time: { fontSize: 10 },
  mineMeta: { color: colors.primarySoft },
  theirsMeta: { color: colors.textFaint },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    backgroundColor: colors.background,
  },
  input: { flex: 1, maxHeight: 120, backgroundColor: colors.surface },
  inputOutline: { borderRadius: radius.md },
  reportButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.xs },
  reportLabel: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  noticeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primarySofter,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryBorder,
  },
  noticeText: { flex: 1, color: colors.text, fontSize: 12 },
  closedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
  },
  closedText: { color: colors.textMuted },
});
