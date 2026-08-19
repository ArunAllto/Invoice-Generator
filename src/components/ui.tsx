/**
 * The shared UI kit.
 *
 * Two accessibility rules from §11 are enforced here rather than left to each screen:
 * every tappable thing is at least 44dp (`TOUCH_TARGET`), and no text container has a fixed
 * height, so system font scaling to 200% grows rows instead of clipping them. Screens that
 * use these components get both for free.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '../strings';
import {
  contrastOn,
  fontSize,
  fontWeight,
  palette,
  radius,
  shadow,
  spacing,
  toneColors,
  TOUCH_TARGET,
  type StatusTone,
} from '../theme';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  children,
  scroll = true,
  footer,
  style,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  /** Sticky footer, e.g. the editor's live total (§6.2). */
  footer?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}): React.ReactElement {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={['bottom']}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, contentStyle]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, contentStyle]}>{children}</View>
      )}
      {footer}
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}): React.ReactElement {
  return <View style={[styles.card, padded && styles.cardPadded, style]}>{children}</View>;
}

export function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {children}
      </Text>
      {action}
    </View>
  );
}

export function Divider(): React.ReactElement {
  return <View style={styles.divider} />;
}

export function Spacer({ size = spacing.md }: { size?: number }): React.ReactElement {
  return <View style={{ height: size }} />;
}

/**
 * A collapsible section, as §6.2 specifies for the editor.
 *
 * Kept mounted when collapsed so a half-typed value in a closed section is never lost.
 */
export function Collapsible({
  title,
  subtitle,
  initiallyOpen = true,
  children,
  badge,
}: {
  title: string;
  subtitle?: string | null;
  initiallyOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <Card padded={false} style={styles.collapsible}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        style={styles.collapsibleHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
      >
        <View style={styles.flex}>
          <Text style={styles.collapsibleTitle}>{title}</Text>
          {subtitle ? <Text style={styles.collapsibleSubtitle}>{subtitle}</Text> : null}
        </View>
        {badge}
        <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      <View style={[styles.collapsibleBody, !open && styles.hidden]}>{children}</View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function Title({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}): React.ReactElement {
  return (
    <Text style={[styles.body, muted && styles.muted, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Caption({
  children,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}): React.ReactElement {
  return (
    <Text style={[styles.caption, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  accentColor,
  style,
  large,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
  large?: boolean;
  accessibilityHint?: string;
}): React.ReactElement {
  const accent = accentColor ?? palette.navy;
  const isDisabled = Boolean(disabled) || Boolean(loading);

  const background =
    variant === 'primary' ? accent : variant === 'danger' ? palette.dangerBg : 'transparent';
  const border =
    variant === 'secondary' ? palette.borderStrong : variant === 'danger' ? palette.danger : 'transparent';
  const color =
    variant === 'primary'
      ? contrastOn(accent)
      : variant === 'danger'
        ? palette.danger
        : accent;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: Boolean(loading) }}
      style={({ pressed }) => [
        styles.button,
        large && styles.buttonLarge,
        { backgroundColor: background, borderColor: border, borderWidth: border === 'transparent' ? 0 : 1 },
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={color} /> : null}
      <Text style={[styles.buttonLabel, large && styles.buttonLabelLarge, { color }]}>{label}</Text>
    </Pressable>
  );
}

/** A large primary action, as the three buttons on Home (§4.1). */
export function BigActionButton({
  label,
  caption,
  onPress,
  accentColor,
}: {
  label: string;
  caption?: string;
  onPress: () => void;
  accentColor?: string;
}): React.ReactElement {
  const accent = accentColor ?? palette.navy;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.bigAction,
        { backgroundColor: accent },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.bigActionLabel, { color: contrastOn(accent) }]}>{label}</Text>
      {caption ? (
        <Text style={[styles.bigActionCaption, { color: contrastOn(accent) }]}>{caption}</Text>
      ) : null}
    </Pressable>
  );
}

export function IconButton({
  label,
  glyph,
  onPress,
  tone = 'neutral',
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  tone?: StatusTone;
}): React.ReactElement {
  const { fg } = toneColors(tone);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
      hitSlop={8}
    >
      <Text style={[styles.iconGlyph, { color: fg }]}>{glyph}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string | null;
  error?: string | null;
  children: React.ReactNode;
  required?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {/*
         * Required fields are marked; optional ones are left plain.
         *
         * The opposite convention — tagging everything optional — put "(optional)" on almost
         * every label in the app, including the document number, which reads as though the user
         * has a choice to make when it is assigned for them.
         */}
        {required ? <Text style={styles.fieldRequired}> *</Text> : null}
      </Text>
      {children}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  hint?: string | null;
  error?: string | null;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'email-address' | 'phone-pad' | 'url';
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  required?: boolean;
  onBlur?: () => void;
  numberOfLines?: number;
  align?: 'left' | 'right';
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  keyboardType = 'default',
  multiline = false,
  autoCapitalize = 'sentences',
  required,
  onBlur,
  numberOfLines,
  align = 'left',
}: TextFieldProps): React.ReactElement {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <TextInput
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          align === 'right' && styles.inputRight,
          error ? styles.inputError : null,
        ]}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={palette.inkFaint}
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={numberOfLines}
        autoCapitalize={autoCapitalize}
        autoCorrect={keyboardType === 'default'}
        // §11: inputs must be labelled for a screen reader.
        accessibilityLabel={label}
      />
    </Field>
  );
}

export function SwitchRow({
  label,
  description,
  value,
  onValueChange,
  accentColor,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  accentColor?: string;
}): React.ReactElement {
  const accent = accentColor ?? palette.navy;
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      style={styles.switchRow}
    >
      <View style={styles.flex}>
        <Text style={styles.switchLabel}>{label}</Text>
        {description ? <Text style={styles.switchDescription}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: accent, false: palette.borderStrong }}
        thumbColor="#FFFFFF"
      />
    </Pressable>
  );
}

export interface Option<T> {
  value: T;
  label: string;
  description?: string;
}

/** A horizontal chip group, used for filters and small enum choices. */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  accentColor,
  multiple,
  values,
  label,
}: {
  options: ReadonlyArray<Option<T>>;
  value?: T;
  onChange: (value: T) => void;
  accentColor?: string;
  multiple?: boolean;
  values?: readonly T[];
  label?: string;
}): React.ReactElement {
  const accent = accentColor ?? palette.navy;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
      accessibilityLabel={label}
    >
      {options.map((option) => {
        const selected = multiple ? (values ?? []).includes(option.value) : value === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={option.label}
            style={[
              styles.chip,
              selected && { backgroundColor: accent, borderColor: accent },
            ]}
          >
            <Text style={[styles.chipLabel, selected && { color: contrastOn(accent) }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A vertical list of radio options, for choices that need descriptions. */
export function OptionList<T extends string>({
  options,
  value,
  onChange,
  accentColor,
}: {
  options: ReadonlyArray<Option<T>>;
  value: T;
  onChange: (value: T) => void;
  accentColor?: string;
}): React.ReactElement {
  const accent = accentColor ?? palette.navy;
  return (
    <View>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={styles.optionRow}
          >
            <View style={[styles.radio, selected && { borderColor: accent }]}>
              {selected ? <View style={[styles.radioDot, { backgroundColor: accent }]} /> : null}
            </View>
            <View style={styles.flex}>
              <Text style={styles.switchLabel}>{option.label}</Text>
              {option.description ? (
                <Text style={styles.switchDescription}>{option.description}</Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: StatusTone;
}): React.ReactElement {
  const { fg, bg } = toneColors(tone);
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Badge({
  label,
  tone = 'info',
}: {
  label: string;
  tone?: StatusTone;
}): React.ReactElement {
  const { fg, bg } = toneColors(tone);
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }): React.ReactElement {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={palette.navy} />
      {label ? <Text style={styles.loadingLabel}>{label}</Text> : null}
    </View>
  );
}

/**
 * An inline error with the diagnostic detail available to copy.
 *
 * §11: "Never a bare stack trace, never a silent failure." The message is plain; the detail
 * is behind a disclosure so it is there when it is needed and invisible when it is not.
 */
export function ErrorNotice({
  message,
  detail,
  onRetry,
}: {
  message: string;
  detail?: string | null;
  onRetry?: () => void;
}): React.ReactElement {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <View style={styles.errorNotice}>
      <Text style={styles.errorMessage}>{message}</Text>
      {detail ? (
        <Pressable onPress={() => setShowDetail((value) => !value)} accessibilityRole="button">
          <Text style={styles.errorToggle}>
            {showDetail ? 'Hide details' : t('copyDetails')}
          </Text>
        </Pressable>
      ) : null}
      {showDetail && detail ? (
        <ScrollView style={styles.errorDetail} horizontal>
          <Text selectable style={styles.errorDetailText}>
            {detail}
          </Text>
        </ScrollView>
      ) : null}
      {onRetry ? (
        <Button label={t('retry')} onPress={onRetry} variant="secondary" style={styles.errorRetry} />
      ) : null}
    </View>
  );
}

/** A dismissible banner, e.g. the incomplete-profile prompt on Home (§4.1). */
export function Banner({
  message,
  actionLabel,
  onAction,
  onDismiss,
  tone = 'info',
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  tone?: StatusTone;
}): React.ReactElement {
  const { fg, bg } = toneColors(tone);
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Text style={[styles.bannerText, { color: fg }]}>{message}</Text>
      <View style={styles.bannerActions}>
        {actionLabel && onAction ? (
          <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.bannerAction, { color: fg }]}>{actionLabel}</Text>
          </Pressable>
        ) : null}
        {onDismiss ? (
          <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel={t('close')} hitSlop={8}>
            <Text style={[styles.bannerAction, { color: fg }]}>✕</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** A brief confirmation, with an optional undo — used by swipe-to-delete (§6.2). */
export function Snackbar({
  message,
  actionLabel,
  onAction,
  onHide,
  duration = 4000,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onHide: () => void;
  duration?: number;
}): React.ReactElement {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    const timer = setTimeout(onHide, duration);
    return () => clearTimeout(timer);
  }, [duration, onHide, opacity]);

  return (
    <Animated.View style={[styles.snackbar, { opacity }]} accessibilityLiveRegion="polite">
      <Text style={styles.snackbarText}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.snackbarAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

/**
 * A bottom sheet.
 *
 * Uses the platform `Modal` rather than a gesture library so the hardware back button
 * closes it, which is what an Android user expects.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel={t('close')} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        {title ? (
          <Text style={styles.sheetTitle} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** A confirmation dialog. Used for anything destructive (§11 error handling). */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.dialogBackdrop}>
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle} accessibilityRole="header">
            {title}
          </Text>
          {message ? <Text style={styles.dialogMessage}>{message}</Text> : null}
          <View style={styles.dialogActions}>
            <Button label={t('cancel')} onPress={onCancel} variant="ghost" />
            <Button
              label={confirmLabel ?? t('confirm')}
              onPress={onConfirm}
              variant={destructive ? 'danger' : 'primary'}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** A tappable row, used throughout the settings hub and list screens. */
export function ListRow({
  title,
  subtitle,
  right,
  onPress,
  onLongPress,
  accessibilityHint,
}: {
  title: string;
  subtitle?: string | null;
  right?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityHint?: string;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.listRow, pressed && onPress ? styles.pressed : null]}
    >
      <View style={styles.flex}>
        <Text style={styles.listTitle}>{title}</Text>
        {subtitle ? <Text style={styles.listSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hidden: { display: 'none' },
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    ...shadow,
  },
  cardPadded: { padding: spacing.lg },

  collapsible: { overflow: 'hidden' },
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    minHeight: TOUCH_TARGET,
  },
  collapsibleTitle: { fontSize: fontSize.bodyLarge, fontWeight: fontWeight.semibold, color: palette.ink },
  collapsibleSubtitle: { marginTop: 2, fontSize: fontSize.small, color: palette.inkMuted },
  collapsibleBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  chevron: { fontSize: fontSize.body, color: palette.inkMuted, paddingHorizontal: spacing.xs },

  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: palette.inkMuted,
  },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: spacing.sm },

  title: { fontSize: fontSize.heading, fontWeight: fontWeight.semibold, color: palette.ink },
  body: { fontSize: fontSize.body, color: palette.ink, lineHeight: fontSize.body * 1.45 },
  muted: { color: palette.inkMuted },
  caption: { fontSize: fontSize.small, color: palette.inkMuted, lineHeight: fontSize.small * 1.45 },

  button: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonLarge: { minHeight: 56, paddingHorizontal: spacing.xl },
  buttonLabel: { fontSize: fontSize.body, fontWeight: fontWeight.semibold, textAlign: 'center' },
  buttonLabelLarge: { fontSize: fontSize.bodyLarge },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },

  bigAction: {
    minHeight: 68,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    justifyContent: 'center',
    ...shadow,
  },
  bigActionLabel: { fontSize: fontSize.bodyLarge, fontWeight: fontWeight.semibold },
  bigActionCaption: { fontSize: fontSize.small, opacity: 0.85, marginTop: 2 },

  iconButton: {
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: { fontSize: fontSize.bodyLarge },

  field: { gap: spacing.xs },
  fieldLabel: { fontSize: fontSize.small, fontWeight: fontWeight.medium, color: palette.inkMuted },
  fieldHint: { fontSize: fontSize.caption, color: palette.inkMuted },
  fieldRequired: { color: palette.danger, fontWeight: fontWeight.semibold },
  fieldError: { fontSize: fontSize.caption, color: palette.danger },
  input: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.body,
    color: palette.ink,
    backgroundColor: palette.surface,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  inputRight: { textAlign: 'right' },
  inputError: { borderColor: palette.danger },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: TOUCH_TARGET,
    paddingVertical: spacing.xs,
  },
  switchLabel: { fontSize: fontSize.body, color: palette.ink },
  switchDescription: { fontSize: fontSize.caption, color: palette.inkMuted, marginTop: 2 },

  chipRow: { gap: spacing.sm, paddingVertical: spacing.xs, paddingRight: spacing.lg },
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    justifyContent: 'center',
  },
  chipLabel: { fontSize: fontSize.small, color: palette.ink, fontWeight: fontWeight.medium },

  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: TOUCH_TARGET,
    paddingVertical: spacing.sm,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioDot: { width: 11, height: 11, borderRadius: 6 },

  pill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  pillLabel: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  badgeLabel: { fontSize: fontSize.caption, fontWeight: fontWeight.medium },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg, gap: spacing.sm },
  emptyTitle: { fontSize: fontSize.bodyLarge, fontWeight: fontWeight.semibold, color: palette.ink, textAlign: 'center' },
  emptyMessage: { fontSize: fontSize.body, color: palette.inkMuted, textAlign: 'center' },
  emptyAction: { marginTop: spacing.sm, alignSelf: 'stretch' },

  loading: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  loadingLabel: { fontSize: fontSize.small, color: palette.inkMuted },

  errorNotice: {
    backgroundColor: palette.dangerBg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorMessage: { fontSize: fontSize.body, color: palette.danger, fontWeight: fontWeight.medium },
  errorToggle: { fontSize: fontSize.small, color: palette.danger, textDecorationLine: 'underline' },
  errorDetail: { maxHeight: 140, backgroundColor: palette.surface, borderRadius: radius.sm, padding: spacing.sm },
  errorDetailText: { fontSize: fontSize.caption, color: palette.inkMuted, fontFamily: 'monospace' },
  errorRetry: { alignSelf: 'flex-start' },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  bannerText: { flex: 1, fontSize: fontSize.small, lineHeight: fontSize.small * 1.4 },
  bannerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bannerAction: { fontSize: fontSize.small, fontWeight: fontWeight.semibold },

  snackbar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    backgroundColor: palette.ink,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  snackbarText: { color: '#FFFFFF', fontSize: fontSize.small, flex: 1 },
  snackbarAction: { color: '#FFFFFF', fontSize: fontSize.small, fontWeight: fontWeight.bold },

  sheetBackdrop: { flex: 1, backgroundColor: palette.overlay },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.sm,
    maxHeight: '86%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.borderStrong,
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
    color: palette.ink,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sheetContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

  dialogBackdrop: {
    flex: 1,
    backgroundColor: palette.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  dialogTitle: { fontSize: fontSize.bodyLarge, fontWeight: fontWeight.semibold, color: palette.ink },
  dialogMessage: { fontSize: fontSize.body, color: palette.inkMuted, lineHeight: fontSize.body * 1.45 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, flexWrap: 'wrap' },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: TOUCH_TARGET + 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: palette.surface,
  },
  listTitle: { fontSize: fontSize.body, color: palette.ink, fontWeight: fontWeight.medium },
  listSubtitle: { fontSize: fontSize.small, color: palette.inkMuted, marginTop: 2 },
});
