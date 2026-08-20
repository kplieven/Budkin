import { useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { fontFamily } from '@/theme/fonts';
import { useAppStore, type AdoptResult } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

/** Warning-card tone, the same amber used by the offline banner and TopBar. */
const WARN_COLOR = '#E2B554';

/** Which content/footer the sheet is showing. A separate `busy` flag, not a 4th
 *  "checking" screen, drives the in-flight spinner, so tapping "Upload anyway" from
 *  the guard card keeps the guard copy on screen while the button spins. */
type Screen = 'form' | 'guard' | 'partial';

export function AdoptSheet() {
  const open = useAppStore((s) => s.adoptSheet);
  if (!open) return null;
  return <Inner />;
}

function Inner() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const adopt = useAppStore((s) => s.adopt);
  const connect = useAppStore((s) => s.connect);
  const showToast = useAppStore((s) => s.showToast);
  const close = useAppStore((s) => s.closeAdopt);

  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [screen, setScreen] = useState<Screen>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // opts used by the most recent attempt, so a `partial` Retry repeats it exactly.
  const [uploadAnyway, setUploadAnyway] = useState(false);

  const canSubmit = url.trim().length > 0 && token.trim().length > 0;

  // Every `adopt()` call MUST be try/caught: a post-upload reload failure isn't
  // wrapped internally and would otherwise reject out of this handler.
  const attempt = async (opts?: { uploadAnyway?: boolean }) => {
    setBusy(true);
    setError(null);
    let result: AdoptResult;
    try {
      result = await adopt(url.trim(), token.trim(), opts);
    } catch (e) {
      result = { status: 'error', message: e instanceof Error ? e.message : "Couldn't reach the server." };
    }
    setBusy(false);
    if (result.status === 'error') {
      setScreen('form');
      setError(result.message);
    } else if (result.status === 'guard') {
      setScreen('guard');
    } else if (result.status === 'partial') {
      setUploadAnyway(!!opts?.uploadAnyway);
      setScreen('partial');
    } else {
      close();
      showToast("Synced — you're now connected.");
    }
  };

  // Guard card's "Use the server's data": switch to the server WITHOUT uploading local
  // data, so the normal connect() flow and not adopt().
  const useServerData = () => {
    void connect(url.trim(), token.trim());
    close();
  };

  const input = {
    height: 54,
    borderRadius: 15,
    backgroundColor: t.surface,
    borderWidth: 1.5,
    borderColor: t.line2,
    paddingHorizontal: 16,
    fontSize: 15.5,
    fontFamily: fontFamily(500),
    color: t.text,
  } as const;

  const warnCard = {
    backgroundColor: t.dark ? '#3A2E18' : '#FBEFD4',
    borderWidth: 1,
    borderColor: hexA(WARN_COLOR, 0.5),
    borderRadius: 16,
    padding: 16,
  } as const;

  return (
    <BottomSheet onClose={close}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14, flexShrink: 0 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(t.primary, t.dark ? 0.2 : 0.16), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="heart" color={t.primary} size={22} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight={800} size={20} tracking={-0.3}>
            Connect Baby Buddy
          </Txt>
        </View>
        <IconButton name="close" onPress={close} size={20} accessibilityLabel="Close" />
      </View>

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        {screen === 'form' && (
          <>
            <Txt weight={500} size={14} color={t.dim} style={{ marginBottom: 20, lineHeight: 20 }}>
              Connect a Baby Buddy server to upload everything on this device and keep it in sync.
            </Txt>

            <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
              SERVER URL
            </Txt>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://babybuddy.home.lan"
              placeholderTextColor={t.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!busy}
              style={[input, { marginBottom: 16 }]}
            />

            <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
              API TOKEN
            </Txt>
            <TextInput
              value={token}
              onChangeText={setToken}
              placeholder="Paste your token…"
              placeholderTextColor={t.faint}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              style={input}
            />
            {error && (
              <Txt weight={600} size={13} color="#E2725B" style={{ marginTop: 8 }}>
                {error}
              </Txt>
            )}
          </>
        )}

        {screen === 'guard' && (
          <View style={warnCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Icon name="info" color={WARN_COLOR} size={18} />
              <Txt weight={700} size={14} color={WARN_COLOR}>
                This server already has data
              </Txt>
            </View>
            <Txt weight={500} size={13.5} color={t.dim} style={{ lineHeight: 20 }}>
              Uploading may create duplicates. Use only the server&apos;s data — this device&apos;s data stays on it but
              isn&apos;t uploaded, and you&apos;ll see the server&apos;s data — or upload this device&apos;s data too.
            </Txt>
          </View>
        )}

        {screen === 'partial' && (
          <View style={warnCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Icon name="info" color={WARN_COLOR} size={18} />
              <Txt weight={700} size={14} color={WARN_COLOR}>
                Some items didn&apos;t upload
              </Txt>
            </View>
            <Txt weight={500} size={13.5} color={t.dim} style={{ lineHeight: 20 }}>
              The connection was interrupted partway through. Retry to finish — items already uploaded won&apos;t be duplicated.
            </Txt>
          </View>
        )}
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: t.line, flexShrink: 0 }}>
        {screen === 'form' && (
          <Tappable
            onPress={() => attempt()}
            disabled={!canSubmit || busy}
            accessibilityRole="button"
            accessibilityLabel="Connect & upload"
            accessibilityState={{ disabled: !canSubmit || busy }}
            style={(s) => [
              {
                flex: 1,
                height: 58,
                borderRadius: 18,
                backgroundColor: t.primary,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: canSubmit ? 1 : 0.5,
                boxShadow: canSubmit ? `0px 8px 22px ${hexA(t.primary, 0.35)}` : undefined,
                cursor: canSubmit && !busy ? 'pointer' : 'auto',
              },
              canSubmit && !busy && isHovered(s) && { boxShadow: `0px 8px 22px ${hexA(t.primary, 0.5)}` },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={t.onPrimary} />
            ) : (
              <Txt unselectable weight={800} size={17.5} color={t.onPrimary}>
                Connect & upload
              </Txt>
            )}
          </Tappable>
        )}

        {screen === 'guard' && (
          <>
            <Tappable
              onPress={useServerData}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Use only the server's data"
              accessibilityState={{ disabled: busy }}
              style={(s) => [
                {
                  flex: 1,
                  height: 58,
                  borderRadius: 18,
                  backgroundColor: t.chip,
                  borderWidth: 1.5,
                  borderColor: t.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: busy ? 'auto' : 'pointer',
                },
                !busy && isHovered(s) && { backgroundColor: t.elevated },
              ]}
            >
              <Txt unselectable weight={800} size={15} color={t.text}>
                Use only the server&apos;s data
              </Txt>
            </Tappable>
            <Tappable
              onPress={() => attempt({ uploadAnyway: true })}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Upload anyway"
              accessibilityState={{ disabled: busy }}
              style={(s) => [
                {
                  flex: 1,
                  height: 58,
                  borderRadius: 18,
                  backgroundColor: t.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: `0px 8px 22px ${hexA(t.primary, 0.35)}`,
                  cursor: busy ? 'auto' : 'pointer',
                },
                !busy && isHovered(s) && { boxShadow: `0px 8px 22px ${hexA(t.primary, 0.5)}` },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={t.onPrimary} />
              ) : (
                <Txt unselectable weight={800} size={15} color={t.onPrimary}>
                  Upload anyway
                </Txt>
              )}
            </Tappable>
          </>
        )}

        {screen === 'partial' && (
          <Tappable
            onPress={() => attempt(uploadAnyway ? { uploadAnyway: true } : undefined)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Retry"
            accessibilityState={{ disabled: busy }}
            style={(s) => [
              {
                flex: 1,
                height: 58,
                borderRadius: 18,
                backgroundColor: t.primary,
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0px 8px 22px ${hexA(t.primary, 0.35)}`,
                cursor: busy ? 'auto' : 'pointer',
              },
              !busy && isHovered(s) && { boxShadow: `0px 8px 22px ${hexA(t.primary, 0.5)}` },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={t.onPrimary} />
            ) : (
              <Txt unselectable weight={800} size={17.5} color={t.onPrimary}>
                Retry
              </Txt>
            )}
          </Tappable>
        )}
      </View>
    </BottomSheet>
  );
}
