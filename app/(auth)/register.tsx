import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import BirthDateField from '../../components/ui/BirthDateField';
import { isEmailRegistered, isPhoneRegistered, signUp } from '../../lib/auth';
import { calculateAge, isRealDate, toBirthDateString } from '../../lib/birthdate';
import { toTitleCase } from '../../lib/format';
import { normalizePhoneNumber } from '../../lib/validation';
import { colors, fonts, radius, spacing } from '../../lib/theme';

// Matches "something@something.something" — a light format check before we
// bother contacting the server.
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export default function Register() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleRegister() {
    const cleanEmail = email.trim().toLowerCase();

    // Guard: required fields (middle name is optional). Phone is required too,
    // since we reuse it later when the user becomes a worker.
    if (!firstName.trim() || !lastName.trim() || !cleanEmail || !phone.trim() || !password || !confirmPassword || !month || !day || !year) {
      return setError('Please fill in all fields.');
    }
    // Guard: reject anything that isn't a plausible email before calling the API.
    if (!EMAIL_PATTERN.test(cleanEmail)) return setError('Please enter a valid email address.');
    // Guard: registration is restricted to Gmail addresses only.
    if (!cleanEmail.endsWith('@gmail.com')) return setError('Please use a @gmail.com address.');

    // Guard: phone must be a valid PH mobile number. normalizePhoneNumber strips
    // spaces/dashes and returns the stored +63 form, or null if the shape is wrong.
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) return setError('Enter a valid Philippine mobile number');
    // Guard: Supabase requires passwords of at least 6 characters.
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    // Guard: the two password fields must match.
    if (password !== confirmPassword) return setError('Passwords do not match.');

    const birthYear = Number(year);
    const birthMonth = Number(month);
    const birthDay = Number(day);

    // Guard: the chosen day must actually exist (e.g. not February 30).
    if (!isRealDate(birthYear, birthMonth, birthDay)) return setError('Please choose a valid birth date.');

    // Age is computed from the birth date, never typed by the user.
    const ageNumber = calculateAge(birthYear, birthMonth, birthDay);
    // Guard: must be at least 18 years old.
    if (ageNumber < 18) return setError('You must be at least 18 years old to register.');

    // Store the three parts as one full name: "First Middle Last", always
    // in proper Title Case so "maRk" is saved as "Mark" no matter what was typed.
    const fullName = [firstName, middleName, lastName].map(toTitleCase).filter(Boolean).join(' ');

    // Store the full birth date so the profile can show month/year and re-derive
    // age over time (the user only ever edits month/year, never age directly).
    const birthDate = toBirthDateString(birthYear, birthMonth, birthDay);

    setError('');
    setSubmitting(true);

    // Guard: block sign-up if the email or phone already belongs to an account,
    // so the user gets a clear message instead of a silent/obscure failure.
    const [emailTaken, phoneTaken] = await Promise.all([
      isEmailRegistered(cleanEmail),
      isPhoneRegistered(normalizedPhone),
    ]);
    if (emailTaken) {
      setSubmitting(false);
      return setError('That email is already registered. Try logging in instead.');
    }
    if (phoneTaken) {
      setSubmitting(false);
      return setError('That phone number is already in use by another account.');
    }

    // New accounts are always created as a regular 'client' (no role picker).
    const { error: signUpError } = await signUp(fullName, ageNumber, cleanEmail, password, normalizedPhone, birthDate);
    setSubmitting(false);

    // Guard: stop and show the server error (e.g. email already registered).
    if (signUpError) return setError(signUpError.message);

    // Success: send them to the confirmation screen with their email. (If email
    // confirmation is OFF, a session is created and RootLayout routes to Home
    // instead — the confirmation screen only matters when confirmation is ON.)
    router.replace({ pathname: '/confirm', params: { email: cleanEmail } });
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Create account</Text>
      <Text style={styles.subtitle}>Join circulaID to hire or get hired</Text>

      <TextInput label="Last Name" mode="outlined" value={lastName} onChangeText={setLastName} style={styles.input} outlineStyle={styles.inputOutline} />
      <TextInput label="First Name" mode="outlined" value={firstName} onChangeText={setFirstName} style={styles.input} outlineStyle={styles.inputOutline} />
      <TextInput
        label="Middle Name (optional)"
        mode="outlined"
        value={middleName}
        onChangeText={setMiddleName}
        style={styles.input}
        outlineStyle={styles.inputOutline}
      />

      <BirthDateField
        label="Date of Birth"
        month={month}
        day={day}
        year={year}
        onChange={(m, d, y) => {
          setMonth(m);
          setDay(d);
          setYear(y);
        }}
        style={styles.input}
      />

      <TextInput
        label="Email Address"
        mode="outlined"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        style={styles.input}
        outlineStyle={styles.inputOutline}
      />
      <TextInput
        label="Phone Number"
        mode="outlined"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        placeholder="09171234567 or +639171234567"
        style={styles.input}
        outlineStyle={styles.inputOutline}
      />
      <TextInput
        label="Password"
        mode="outlined"
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        style={styles.input}
        outlineStyle={styles.inputOutline}
        right={
          <TextInput.Icon
            icon={showPassword ? 'eye' : 'eye-off'}
            onPress={() => setShowPassword((v) => !v)}
            forceTextInputFocus={false}
          />
        }
      />
      <TextInput
        label="Confirm Password"
        mode="outlined"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry={!showConfirm}
        autoCapitalize="none"
        style={styles.input}
        outlineStyle={styles.inputOutline}
        right={
          <TextInput.Icon
            icon={showConfirm ? 'eye' : 'eye-off'}
            onPress={() => setShowConfirm((v) => !v)}
            forceTextInputFocus={false}
          />
        }
      />

      <HelperText type="error" visible={!!error}>
        {error}
      </HelperText>

      <Button
        mode="contained"
        onPress={handleRegister}
        loading={submitting}
        disabled={submitting}
        style={styles.button}
        contentStyle={styles.buttonContent}
        labelStyle={styles.buttonLabel}
      >
        Register
      </Button>

      <Button mode="text" onPress={() => router.replace('/login')} labelStyle={styles.link}>
        Already have an account? Log in
      </Button>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.xxl,
    justifyContent: 'center',
    paddingTop: spacing.xxl,
    // Extra bottom room so the lower inputs + button can scroll clear of the keyboard.
    paddingBottom: spacing.xxxl,
  },
  title: { fontFamily: fonts.display, fontSize: 32, color: colors.text, textAlign: 'center' },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 15,
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  inputOutline: { borderRadius: radius.md },
  button: { borderRadius: radius.pill, marginTop: spacing.sm, marginBottom: spacing.sm },
  buttonContent: { paddingVertical: spacing.sm },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 16 },
  link: { fontFamily: fonts.bodyMedium, color: colors.primaryAccent },
});
