import Constants from 'expo-constants';
import { openBrowserAsync } from 'expo-web-browser';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { versionLabel } from '@/lib/appVersion';
import { fontFamily } from '@/theme/fonts';
import { hexA } from '@/lib/color';
import { shadowStyle } from '@/theme/shadow';
import { useAppStore } from '@/store/useAppStore';
import type { SavedServer } from '@/data/servers';
import { useTheme } from '@/theme/useTheme';
import { SavedServerList } from '@/features/connect/SavedServerList';
import { SetupButton } from '@/features/setup/SetupButton';
import { nextAfterConnect } from '@/features/setup/routing';
import { useFinishSetup } from '@/features/setup/useFinishSetup';

export default function Onboarding() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');

  const connected = useAppStore((s) => s.connected);
  const connecting = useAppStore((s) => s.connecting);
  const connectError = useAppStore((s) => s.connectError);
  const connect = useAppStore((s) => s.connect);
  const connection = useAppStore((s) => s.connection);
  const enterLocal = useAppStore((s) => s.enterLocal);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const finish = useFinishSetup();

  // Local mode also sets `connected`, so this screen keys off a real SERVER
  // connection: entering local mode must not make the connect form unreachable.
  const serverConnected = connected && connection?.mode === 'server';
  const offeredBabyStep = useRef(false);

  // Re-decided on focus, not just on a dependency change: coming BACK from the
  // add-baby step has to be handled too, or a user who reached this as the stack
  // root is stranded on a form that can no longer do anything. A fresh Baby Buddy
  // install has no children on it, so a successful connect continues into the
  // add-baby step rather than dropping the user on an empty Home.
  useFocusEffect(
    useCallback(() => {
      // Released here rather than in a `finally` after the push: push leaves this
      // screen mounted under /setup/baby, so coming back re-focuses this same
      // instance, and a finally would instead reopen the double-tap window while
      // the push animates. Setting it doesn't touch this effect's deps, so there
      // is no re-run loop.
      setEntering(false);
      if (!serverConnected) return;
      if (
        !offeredBabyStep.current &&
        nextAfterConnect(useAppStore.getState().children.length) === '/setup/baby'
      ) {
        offeredBabyStep.current = true;
        router.push('/setup/baby');
        return;
      }
      finish();
    }, [serverConnected, finish]),
  );

  // The way out of this screen without a server. It has to live here and not only on
  // /welcome: signing out replaces the stack with this form, and /welcome then
  // redirects away on `tutorialSeen`, so without this the user is stuck on a form
  // they may have no server for. Guarded against a double tap the same way as
  // /welcome, since enterLocal does async storage work before the navigation.
  const goLocal = async () => {
    if (entering || connecting) return;
    setEntering(true);
    await enterLocal();
    // A local store with children already on it (backing out of the connect form on
    // first run) goes straight to Home; the empty one a sign-out leaves behind takes
    // the add-baby step, which finishes setup itself.
    if (nextAfterConnect(useAppStore.getState().children.length) === '/setup/baby') {
      router.push('/setup/baby');
      return;
    }
    finish();
  };

  // Tapping a saved row prefills the inputs (so a failed reconnect leaves the
  // fields ready to fix) and reuses the normal connect action.
  const tryServer = (srv: SavedServer) => {
    setUrl(srv.serverUrl);
    setToken(srv.token);
    setPendingUrl(srv.serverUrl);
    connect(srv.serverUrl, srv.token);
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
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{
        alignItems: 'center',
        paddingTop: insets.top + 24,
        paddingHorizontal: 24,
        paddingBottom: insets.bottom + 24,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Capped so the form isn't full-bleed on wide desktop/web viewports. */}
      <View style={{ width: '100%', maxWidth: 460 }}>
        {router.canGoBack() && (
          <Tappable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={10}
            style={(s) => [
              { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginLeft: -8, marginBottom: 8, cursor: 'pointer' },
              isHovered(s) && { backgroundColor: t.chip },
            ]}
          >
            <Icon name="chevron-left" color={t.text} size={22} />
          </Tappable>
        )}
        <View
          style={[
            {
              width: 60,
              height: 60,
              borderRadius: 19,
              backgroundColor: t.primary,
              alignItems: 'center',
              justifyContent: 'center',
            },
            shadowStyle(`0px 8px 24px ${hexA(t.primary, 0.4)}`),
          ]}
        >
          <Icon name="budkin" color={t.onPrimary} size={30} />
        </View>

        <Txt weight={800} size={28} tracking={-0.6} style={{ marginTop: 22, lineHeight: 34 }}>
          Connect your{'\n'}Baby Buddy server
        </Txt>
        <Txt weight={500} size={15} color={t.dim} style={{ marginTop: 10, lineHeight: 22 }}>
          Baby Buddy runs on your own server. Paste its address and an access token to start logging.
        </Txt>

        <SavedServerList
          onPick={tryServer}
          busyUrl={connecting ? pendingUrl : null}
          disabled={connecting}
          style={{ marginTop: 26 }}
        />

        <View style={{ marginTop: 26 }}>
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
            style={input}
          />
        </View>

        <View style={{ marginTop: 16 }}>
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
            style={input}
          />
          {connectError && (
            <Txt weight={600} size={13} color="#E2725B" style={{ marginTop: 8 }}>
              {connectError}
            </Txt>
          )}
        </View>

        <View
          style={{
            marginTop: 20,
            backgroundColor: hexA(t.primary, t.dark ? 0.1 : 0.08),
            borderWidth: 1,
            borderColor: hexA(t.primary, 0.3),
            borderRadius: 16,
            padding: 16,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Icon name="info" color={t.primary} size={18} />
            <Txt weight={700} size={14} color={t.primary}>
              Where do I find my token?
            </Txt>
          </View>
          <Txt weight={500} size={13.5} color={t.dim} style={{ lineHeight: 20 }}>
            On your server, open <Txt weight={700} size={13.5} color={t.text}>Settings → User → API</Txt>. Copy
            the long token string and paste it above. Never your password.
          </Txt>
        </View>

        <Tappable
          onPress={() => { setPendingUrl(null); connect(url, token); }}
          disabled={connecting}
          accessibilityRole="button"
          accessibilityLabel="Connect"
          accessibilityState={{ disabled: connecting }}
          style={(s) => [
            {
              marginTop: 24,
              height: 56,
              borderRadius: 17,
              backgroundColor: t.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: connecting ? 0.85 : 1,
              cursor: connecting ? 'auto' : 'pointer',
            },
            shadowStyle(`0px 8px 22px ${hexA(t.primary, 0.35)}`),
            !connecting && isHovered(s) && { opacity: 0.9 },
          ]}
        >
          {connecting ? (
            <ActivityIndicator color={t.onPrimary} />
          ) : (
            <Txt unselectable weight={800} size={17} color={t.onPrimary}>
              Connect
            </Txt>
          )}
        </Tappable>

        <Txt weight={500} size={13.5} color={t.faint} style={{ textAlign: 'center', marginTop: 14 }}>
          Don&apos;t have a server?{' '}
          <Txt
            weight={600}
            size={13.5}
            color={t.primary}
            accessibilityRole="link"
            onPress={() => openBrowserAsync('https://docs.baby-buddy.net/setup/deployment/')}
            style={{ textDecorationLine: 'underline' }}
          >
            Learn how to host one
          </Txt>
        </Txt>

        {/* Same label and secondary styling as the fork on /welcome, so the choice
            reads as the same one wherever it is met. */}
        <SetupButton
          label="Just use this device"
          variant="secondary"
          onPress={goLocal}
          disabled={entering || connecting}
          style={{ marginTop: 16 }}
        />

        {/* Repeated from Settings deliberately. Settings sits behind the
            connection gate, so a disconnected or fresh install routes here and
            can never reach it, which is exactly the state in which someone needs
            to know what they are running. */}
        <Txt weight={500} size={12.5} color={t.faint} style={{ textAlign: 'center', marginTop: 22 }}>
          {versionLabel(Constants.expoConfig?.extra?.version)}
        </Txt>
      </View>
    </ScrollView>
  );
}
