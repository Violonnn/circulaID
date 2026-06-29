import { Ionicons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Dialog,
  HelperText,
  Portal,
  Text,
  TextInput,
} from 'react-native-paper';
import Dropdown from '../../../components/Dropdown';
import PlaceholderImage from '../../../components/PlaceholderImage';
import RoleSwitcher from '../../../components/RoleSwitcher';
import SuspendedBanner from '../../../components/SuspendedBanner';
import KeyboardAvoider from '../../../components/ui/KeyboardAvoider';
import ScreenTitle from '../../../components/ui/ScreenTitle';
import { deleteOwnAccount, signOut, updateUserProfile, uploadAvatar } from '../../../lib/auth';
import { useAuth } from '../../../lib/auth-context';
import {
  ageFromBirthDate,
  formatBirthMonthYear,
  MONTH_OPTIONS,
  parseBirthDate,
  toBirthDateString,
  YEAR_OPTIONS,
} from '../../../lib/birthdate';
import { ACTIVE_ROLE, type ActiveRole } from '../../../lib/constants';
import { formatPeso, toTitleCase } from '../../../lib/format';
import { getWalletBalance } from '../../../lib/payments';
import { useRole } from '../../../lib/role-context';
import { colors, fonts, radius, shadow, spacing } from '../../../lib/theme';
import { normalizePhoneNumber } from '../../../lib/validation';
import { updateWorkerProfileFields } from '../../../lib/worker';

const NAME_EDIT_COOLDOWN_DAYS = 7;

// PROFILE TAB. Shows the account fields (with inline editing), the worker
// profile + wallet (worker view only), an About section, and the session
// actions. Editing happens in-place — tapping "Edit" turns the displayed values
// into inputs rather than opening a modal.
export default function ProfileTab() {
  const router = useRouter();
  const navigation = useNavigation();
  const { profile, refreshProfile } = useAuth();
  const {
    activeRole,
    setActiveRole,
    hasActiveWorkerProfile,
    workerProfile,
    isWorkerSuspended,
    refreshWorkerProfile,
  } = useRole();

  // The role the user has TAPPED but not yet confirmed (drives the modal). Null
  // means no switch is pending and the confirmation modal is closed.
  const [pendingRole, setPendingRole] = useState<ActiveRole | null>(null);

  const [balance, setBalance] = useState<number | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Worker bio/location inline editor.
  const [editingWorker, setEditingWorker] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [locationDraft, setLocationDraft] = useState('');
  const [savingWorker, setSavingWorker] = useState(false);
  const [workerError, setWorkerError] = useState('');

  // Account-details inline editor (name / birth month+year / phone — not email).
  const [editingDetails, setEditingDetails] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [monthDraft, setMonthDraft] = useState('');
  const [yearDraft, setYearDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState('');

  // Delete-account confirmation (user must type CONFIRM to enable the button).
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const canConfirmDelete = confirmText.trim().toUpperCase() === 'CONFIRM';

  const isWorkerView = activeRole === ACTIVE_ROLE.WORKER;

  // How many days until the user may change their name again (0 = allowed now).
  const nameCooldownDays = daysUntilNameEditable(profile?.name_updated_at ?? null);
  const canEditName = nameCooldownDays === 0;

  const birthMonthYear = formatBirthMonthYear(profile?.birth_date) ?? '—';
  const displayAge = profile?.age ?? ageFromBirthDate(profile?.birth_date) ?? null;

  const loadBalance = useCallback(async () => {
    setBalance(await getWalletBalance());
  }, []);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  async function handleLogout() {
    setLoggingOut(true);
    await signOut();
    // The auth listener in RootLayout routes back to Login.
  }

  // Pick an image from the library, then upload it as the profile photo.
  async function changePhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    // Guard: can't read photos without permission.
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo access to change your picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });
    // Guard: the user backed out.
    if (result.canceled) return;

    const asset = result.assets[0];
    // Guard: we asked for base64 — bail clearly if it's missing.
    if (!asset?.base64) {
      Alert.alert('Could not read image', 'Please try a different photo.');
      return;
    }

    setUploadingPhoto(true);
    const res = await uploadAvatar({ base64: asset.base64, mimeType: asset.mimeType });
    setUploadingPhoto(false);
    if (!res.success) {
      Alert.alert('Upload failed', res.message);
      return;
    }
    await refreshProfile();
  }

  // ---- Worker bio/location inline editing -----------------------------------
  function openWorkerEditor() {
    setWorkerError('');
    setBioDraft(workerProfile?.bio ?? '');
    setLocationDraft(workerProfile?.location ?? '');
    setEditingWorker(true);
  }

  async function saveWorker() {
    setWorkerError('');

    // Guard: location is required so clients know roughly where the worker is.
    if (!locationDraft.trim()) return setWorkerError('Please enter your location.');

    setSavingWorker(true);
    const result = await updateWorkerProfileFields({ bio: bioDraft, location: locationDraft });
    if (!result.success) {
      setSavingWorker(false);
      return setWorkerError(result.message);
    }
    await refreshWorkerProfile();
    setSavingWorker(false);
    setEditingWorker(false);
  }

  // ---- Account-details inline editing ---------------------------------------
  function openDetailsEditor() {
    setDetailsError('');
    setNameDraft(toTitleCase(profile?.full_name ?? ''));
    const parts = parseBirthDate(profile?.birth_date);
    setMonthDraft(parts ? String(parts.month) : '');
    setYearDraft(parts ? String(parts.year) : '');
    setPhoneDraft(profile?.phone_number ?? '');
    setEditingDetails(true);
  }

  async function saveDetails() {
    setDetailsError('');

    // Only send a CHANGED name. If the user left it alone (or can't edit it yet),
    // we re-send the stored value verbatim so the DB sees no change and never
    // trips the once-a-week name guard while they're just editing birthday/phone.
    const storedName = profile?.full_name ?? '';
    const trimmed = nameDraft.trim();
    let fullName = storedName;
    if (canEditName && trimmed && toTitleCase(trimmed) !== toTitleCase(storedName)) {
      fullName = toTitleCase(trimmed);
    }
    if (!fullName) return setDetailsError('Please enter your full name.');

    // Guard: birth month + year are required to derive a valid age.
    const month = Number(monthDraft);
    const year = Number(yearDraft);
    if (!month || !year) return setDetailsError('Please choose your birth month and year.');

    // Keep the original day-of-month if we have one; otherwise default to the 1st.
    const existingDay = parseBirthDate(profile?.birth_date)?.day ?? 1;
    const birthDate = toBirthDateString(year, month, existingDay);

    // Guard: derived age must still be an adult (matches registration).
    const age = ageFromBirthDate(birthDate);
    if (age === null || age < 18) {
      return setDetailsError('You must be at least 18 years old.');
    }

    // Guard: phone must be a valid PH mobile number (stored as +63...).
    const normalizedPhone = normalizePhoneNumber(phoneDraft);
    if (!normalizedPhone) return setDetailsError('Enter a valid Philippine mobile number.');

    setSavingDetails(true);
    const result = await updateUserProfile({
      full_name: fullName,
      birth_date: birthDate,
      phone_number: normalizedPhone,
    });
    if (!result.success) {
      setSavingDetails(false);
      return setDetailsError(result.message);
    }
    await refreshProfile();
    setSavingDetails(false);
    setEditingDetails(false);
  }

  async function confirmDelete() {
    setDeleteError('');
    setDeleting(true);
    const result = await deleteOwnAccount();
    if (!result.success) {
      setDeleting(false);
      return setDeleteError(result.message);
    }
  }

  // ---- Role switch (confirmed via modal, then resets the stack) --------------
  function confirmRoleSwitch() {
    // Guard: nothing pending -> nothing to do.
    if (!pendingRole) return;
    const target = pendingRole;
    setPendingRole(null);

    // Switch the UI context first so the feed tab renders the right view.
    setActiveRole(target);

    // Clear screen-level local state so nothing from this screen carries over
    // into the new role's view.
    setEditingDetails(false);
    setEditingWorker(false);
    setDeleteOpen(false);
    setConfirmText('');
    setDetailsError('');
    setWorkerError('');
    setDeleteError('');

    // Reset the stack so there is no back path into the previous role's screens.
    // Both roles land on the same `feed` route: it renders the Feed for clients
    // and the Job screen for workers (see feed.tsx). We reset the parent (app)
    // Stack down to a fresh tab shell focused on that route.
    const rootNav = navigation.getParent() ?? navigation;
    rootNav.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: '(tabs)', params: { screen: 'feed' } }],
      })
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenTitle title="Profile" />
      <KeyboardAvoider style={styles.flex}>
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <SuspendedBanner />

          {/* Header: avatar placeholder + identity, all from the real users row. */}
          <View style={styles.header}>
            <Pressable onPress={changePhoto} disabled={uploadingPhoto} style={styles.avatarButton}>
              <PlaceholderImage
                label={initials(profile?.full_name ?? null)}
                uri={profile?.avatar_url}
                width={88}
                height={88}
                borderRadius={44}
              />
              <Text variant="labelMedium" style={styles.avatarHint}>
                {uploadingPhoto ? 'Uploading…' : 'Change Profile Photo'}
              </Text>
            </Pressable>
            <Text variant="titleLarge" style={styles.headerName}>
              {toTitleCase(profile?.full_name ?? '') || '—'}
            </Text>
            <Text variant="bodySmall" style={styles.headerEmail}>
              {profile?.email ?? '—'}
            </Text>
          </View>

          {/* Account: read-only fields that flip to inputs in place when editing. */}
          <Card style={styles.card}>
            <Card.Title title="Account" titleStyle={styles.cardTitle} />
            <Card.Content>
              {editingDetails ? (
                <View style={styles.editor}>
                  <TextInput
                    label="Full name"
                    mode="outlined"
                    value={nameDraft}
                    onChangeText={setNameDraft}
                    disabled={!canEditName}
                    style={styles.input}
                  />
                  <HelperText type="info" visible={!canEditName}>
                    You can change your name again in {nameCooldownDays} day
                    {nameCooldownDays === 1 ? '' : 's'}.
                  </HelperText>

                  <View style={styles.row}>
                    <Dropdown
                      label="Birth month"
                      value={monthDraft}
                      options={MONTH_OPTIONS}
                      onSelect={setMonthDraft}
                      style={styles.flexWide}
                    />
                    <Dropdown
                      label="Birth year"
                      value={yearDraft}
                      options={YEAR_OPTIONS}
                      onSelect={setYearDraft}
                      style={styles.flexNarrow}
                    />
                  </View>
                  <Text variant="bodySmall" style={styles.derivedNote}>
                    Age is calculated from your birth date.
                  </Text>

                  <TextInput
                    label="Phone number"
                    mode="outlined"
                    value={phoneDraft}
                    onChangeText={setPhoneDraft}
                    keyboardType="phone-pad"
                    placeholder="09171234567 or +639171234567"
                    style={styles.input}
                  />

                  <View style={styles.readonlyRow}>
                    <Ionicons name="mail-outline" size={18} color={colors.textMuted} />
                    <Text variant="bodyMedium" style={styles.readonlyText}>
                      {profile?.email ?? '—'} (email can&apos;t be changed)
                    </Text>
                  </View>

                  <HelperText type="error" visible={!!detailsError}>
                    {detailsError}
                  </HelperText>

                  <View style={styles.editorActions}>
                    <Button onPress={() => setEditingDetails(false)} disabled={savingDetails}>
                      Cancel
                    </Button>
                    <Button mode="contained" onPress={saveDetails} loading={savingDetails} disabled={savingDetails}>
                      Save
                    </Button>
                  </View>
                </View>
              ) : (
                <>
                  <Field icon="person-outline" label="Full name" value={toTitleCase(profile?.full_name ?? '') || '—'} />
                  <Field icon="calendar-outline" label="Birthday" value={birthMonthYear} />
                  <Field icon="hourglass-outline" label="Age" value={displayAge !== null ? String(displayAge) : '—'} />
                  <Field icon="call-outline" label="Phone" value={profile?.phone_number ?? '—'} />
                  <Field icon="mail-outline" label="Email" value={profile?.email ?? '—'} />
                </>
              )}
            </Card.Content>
            {!editingDetails ? (
              <Card.Actions>
                <Button onPress={openDetailsEditor}>Edit details</Button>
              </Card.Actions>
            ) : null}
          </Card>

          {/* Mode: the client/worker toggle. Only active workers see this (the
              switcher renders nothing otherwise). Tapping the other side opens a
              confirmation modal before the switch actually happens. */}
          {hasActiveWorkerProfile ? (
            <Card style={styles.card}>
              <Card.Title title="Mode" titleStyle={styles.cardTitle} />
              <Card.Content>
                <Text variant="bodySmall" style={styles.note}>
                  Switch between using CirculaID as a client or as a worker.
                </Text>
                <View style={styles.modeSwitch}>
                  <RoleSwitcher onRequestChange={(next) => setPendingRole(next)} />
                </View>
              </Card.Content>
            </Card>
          ) : null}

          {/* Wallet — worker view only (the worker's earnings space). */}
          {isWorkerView ? (
            <Card style={styles.card}>
              <Card.Title
                title="Wallet"
                titleStyle={styles.cardTitle}
                left={() => <Ionicons name="wallet-outline" size={22} color={colors.success} />}
              />
              <Card.Content>
                <Text variant="headlineSmall" style={styles.balance}>
                  {balance === null ? '—' : formatPeso(balance)}
                </Text>
                <Text variant="bodySmall" style={styles.note}>
                  Available balance
                </Text>
              </Card.Content>
            </Card>
          ) : null}

          {/* Worker profile (bio/location/rating) — worker view only, edited in place. */}
          {isWorkerView && workerProfile ? (
            <Card style={styles.card}>
              <Card.Title
                title="Worker Profile"
                titleStyle={styles.cardTitle}
                left={() => <Ionicons name="briefcase-outline" size={22} color={colors.primary} />}
              />
              <Card.Content>
                {editingWorker ? (
                  <View style={styles.editor}>
                    <TextInput
                      label="Bio"
                      mode="outlined"
                      value={bioDraft}
                      onChangeText={setBioDraft}
                      multiline
                      numberOfLines={4}
                      style={styles.input}
                    />
                    <TextInput
                      label="Location"
                      mode="outlined"
                      value={locationDraft}
                      onChangeText={setLocationDraft}
                      placeholder="e.g. Lahug, Cebu City"
                      style={styles.input}
                    />
                    <HelperText type="error" visible={!!workerError}>
                      {workerError}
                    </HelperText>
                    <View style={styles.editorActions}>
                      <Button onPress={() => setEditingWorker(false)} disabled={savingWorker}>
                        Cancel
                      </Button>
                      <Button mode="contained" onPress={saveWorker} loading={savingWorker} disabled={savingWorker}>
                        Save
                      </Button>
                    </View>
                  </View>
                ) : (
                  <>
                    <Field icon="reader-outline" label="Bio" value={workerProfile.bio?.trim() || 'No bio yet'} />
                    <Field icon="location-outline" label="Location" value={workerProfile.location || '—'} />
                    <Field
                      icon="star-outline"
                      label="Rating"
                      value={
                        workerProfile.rating_count > 0
                          ? `${Number(workerProfile.rating_avg).toFixed(1)} ★ (${workerProfile.rating_count})`
                          : 'No ratings yet'
                      }
                    />
                  </>
                )}
              </Card.Content>
              {!editingWorker ? (
                <Card.Actions>
                  <Button onPress={openWorkerEditor} disabled={isWorkerSuspended}>
                    Edit profile
                  </Button>
                </Card.Actions>
              ) : null}
            </Card>
          ) : null}

          {/* Client view with no worker profile yet → invite them to become one. */}
          {!isWorkerView && !workerProfile ? (
            <Card style={styles.card}>
              <Card.Title title="Become a Worker" titleStyle={styles.cardTitle} />
              <Card.Content>
                <Text variant="bodyMedium">
                  Activate a worker profile to start posting jobs and getting hired
                  from this same account.
                </Text>
              </Card.Content>
              <Card.Actions>
                <Button mode="contained" onPress={() => router.push('/worker-intent')}>
                  Set up worker profile
                </Button>
              </Card.Actions>
            </Card>
          ) : null}

          {/* Log out + delete, wrapped in a container like every other section. */}
          <Card style={styles.card}>
            <Card.Content style={styles.actionsContent}>
              <Button
                mode="outlined"
                icon="logout"
                onPress={handleLogout}
                loading={loggingOut}
                disabled={loggingOut}
                style={styles.logout}
              >
                Log out
              </Button>
              <Button
                mode="text"
                textColor={colors.danger}
                onPress={() => {
                  setDeleteError('');
                  setConfirmText('');
                  setDeleteOpen(true);
                }}
                style={styles.deleteAccount}
              >
                Delete account
              </Button>
            </Card.Content>
          </Card>

          {/* About — client view only. A tappable row that opens the dedicated
              "About CirculaID" screen (keeps this tab uncluttered). */}
          {!isWorkerView ? (
            <Pressable
              style={styles.aboutWrap}
              onPress={() => router.push('/about')}
              accessibilityRole="button"
            >
              <Text variant="titleSmall" style={styles.aboutTitle}>
                About CirculaID
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
          ) : null}

          <Portal>
            {/* Role-switch confirmation. Icon differs by destination: a briefcase
                for the worker side, a person for the client side. Cancel does
                nothing; Confirm switches the role and resets the stack. */}
            <Dialog visible={pendingRole !== null} onDismiss={() => setPendingRole(null)}>
              <Dialog.Icon
                icon={pendingRole === ACTIVE_ROLE.WORKER ? 'briefcase' : 'account'}
              />
              <Dialog.Content>
                <Text variant="bodyLarge" style={styles.switchText}>
                  Switching to {pendingRole === ACTIVE_ROLE.WORKER ? 'Worker' : 'Client'} mode
                </Text>
              </Dialog.Content>
              <Dialog.Actions style={styles.switchActions}>
                <Button onPress={() => setPendingRole(null)}>Cancel</Button>
                <Button mode="contained" onPress={confirmRoleSwitch}>
                  Confirm
                </Button>
              </Dialog.Actions>
            </Dialog>

            <Dialog visible={deleteOpen} onDismiss={() => !deleting && setDeleteOpen(false)}>
              <Dialog.Title>Delete account?</Dialog.Title>
              <Dialog.Content>
                <Text variant="bodyMedium">
                  This permanently deletes your account and all of your data. This
                  action cannot be undone. Type CONFIRM to proceed.
                </Text>
                <TextInput
                  mode="outlined"
                  value={confirmText}
                  onChangeText={setConfirmText}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="CONFIRM"
                  style={styles.confirmInput}
                />
                <HelperText type="error" visible={!!deleteError}>
                  {deleteError}
                </HelperText>
              </Dialog.Content>
              <Dialog.Actions>
                <Button onPress={() => setDeleteOpen(false)} disabled={deleting}>
                  Cancel
                </Button>
                <Button
                  mode="contained"
                  buttonColor={colors.danger}
                  onPress={confirmDelete}
                  loading={deleting}
                  disabled={deleting || !canConfirmDelete}
                >
                  Delete
                </Button>
              </Dialog.Actions>
            </Dialog>
          </Portal>
        </ScrollView>
      </KeyboardAvoider>
    </View>
  );
}

// Whole days remaining before the name can be edited again (0 = editable now).
function daysUntilNameEditable(nameUpdatedAt: string | null): number {
  if (!nameUpdatedAt) return 0;
  const last = new Date(nameUpdatedAt).getTime();
  if (Number.isNaN(last)) return 0;
  const elapsedDays = (Date.now() - last) / (1000 * 60 * 60 * 24);
  const remaining = Math.ceil(NAME_EDIT_COOLDOWN_DAYS - elapsedDays);
  return remaining > 0 ? remaining : 0;
}

// Initials for the avatar placeholder, derived from the real full name.
function initials(name: string | null): string {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '–';
}

// Tiny labeled row used throughout the profile cards, with a leading icon.
function Field({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Ionicons name={icon} size={18} color={colors.textMuted} style={styles.fieldIcon} />
      <View style={styles.fieldBody}>
        <Text variant="bodySmall" style={styles.fieldLabel}>
          {label}
        </Text>
        <Text variant="bodyLarge">{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 120 },
  header: { alignItems: 'center', marginBottom: spacing.xl, gap: spacing.xs + 2 },
  avatarButton: { alignItems: 'center', gap: spacing.xs },
  avatarHint: { color: colors.primary },
  headerName: { fontFamily: fonts.display, color: colors.text },
  headerEmail: { color: colors.textMuted },
  card: { marginBottom: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.card },
  cardTitle: { fontFamily: fonts.bodyBold, color: colors.text },
  field: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.md + 2 },
  fieldIcon: { marginTop: 4 },
  fieldBody: { flex: 1 },
  fieldLabel: { color: colors.textMuted, marginBottom: 2 },
  balance: { fontFamily: fonts.display, color: colors.success },
  note: { color: colors.textMuted, marginTop: spacing.xs },
  modeSwitch: { marginTop: spacing.md, alignItems: 'center' },
  switchText: { textAlign: 'center', color: colors.text },
  switchActions: { justifyContent: 'center', gap: spacing.sm },
  // Inline editor bits.
  editor: { gap: spacing.xs },
  input: { backgroundColor: colors.surface },
  row: { flexDirection: 'row', gap: spacing.sm },
  flexWide: { flex: 1.4 },
  flexNarrow: { flex: 1 },
  derivedNote: { color: colors.textFaint, marginTop: spacing.xs, marginBottom: spacing.sm },
  readonlyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  readonlyText: { color: colors.textMuted, flex: 1 },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xs },
  actionsContent: { gap: spacing.xs },
  logout: { borderRadius: radius.pill },
  deleteAccount: { marginTop: spacing.xs },
  confirmInput: { marginTop: spacing.md, backgroundColor: colors.surface },
  // About row at the very bottom — a tappable link to the About screen.
  aboutWrap: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aboutTitle: { fontFamily: fonts.bodyBold, color: colors.textMuted },
});
