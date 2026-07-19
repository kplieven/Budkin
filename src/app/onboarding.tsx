import { openBrowserAsync } from 'expo-web-browser';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { fontFamily } from '@/theme/fonts';
import { hexA } from '@/lib/color';
import { shadowStyle } from '@/theme/shadow';
import { useAppStore } from '@/store/useAppStore';
import type { SavedServer } from '@/data/servers';
import { useTheme } from '@/theme/useTheme';
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
  const savedServers = useAppStore((s) => s.savedServers);
  const forgetServer = useAppStore((s) => s.forgetServer);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const children = useAppStore((s) => s.children);
  const finish = useFinishSetup();

  // A fresh Baby Buddy install has no children on it, so connecting is not the
  // end of setup: continue into the add-baby step instead of dropping the user
  // on an empty Home. `children` is the raw store array, not a derived one, so
  // this selector is reference-stable.
  useEffect(() => {
    if (!connected) return;
    if (nextAfterConnect(children.length) === '/setup/baby') router.push('/setup/baby');
    else finish();
  }, [connected, children.length, finish]);

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
      contentContainerStyle={{ paddingTop: insets.top + 24, paddingHorizontal: 24, paddingBottom: insets.bottom + 24 }}
      keyboardShouldPersistTaps="handled"
    >
      {router.canGoBack() && (
        <Pressable
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
        </Pressable>
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
        <Icon name="heart" color={t.onPrimary} size={30} />
      </View>

      <Txt weight={800} size={28} tracking={-0.6} style={{ marginTop: 22, lineHeight: 34 }}>
        Connect your{'\n'}Baby Buddy server
      </Txt>
      <Txt weight={500} size={15} color={t.dim} style={{ marginTop: 10, lineHeight: 22 }}>
        Baby Buddy runs on your own server. Paste its address and an access token to start logging.
      </Txt>

      {savedServers.length > 0 && (
        <View style={{ marginTop: 26 }}>
          <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
            PREVIOUSLY CONNECTED
          </Txt>
          {savedServers.map((srv) => {
            const host = srv.serverUrl.replace(/^https?:\/\//, '');
            const busy = pendingUrl === srv.serverUrl && connecting;
            return (
              <Pressable
                key={srv.serverUrl}
                onPress={() => tryServer(srv)}
                disabled={connecting}
                accessibilityRole="button"
                accessibilityState={{ disabled: connecting }}
                style={(s) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 60,
                    borderRadius: 15,
                    backgroundColor: t.surface,
                    borderWidth: 1.5,
                    borderColor: t.line2,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    marginBottom: 10,
                    cursor: connecting ? 'auto' : 'pointer',
                  },
                  !connecting && isHovered(s) && { borderColor: t.line },
                ]}
              >
                <Icon name="clock" color={t.dim} size={20} />
                <View style={{ flex: 1 }}>
                  <Txt unselectable weight={600} size={15} numberOfLines={1}>
                    {host}
                  </Txt>
                  <Txt unselectable weight={500} size={12.5} color={t.dim} style={{ marginTop: 2 }}>
                    {'••••'}
                    {srv.token.slice(-4)}
                  </Txt>
                </View>
                {busy ? (
                  <ActivityIndicator color={t.dim} />
                ) : (
                  <Pressable
                    onPress={() => forgetServer(srv.serverUrl)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${host}`}
                    style={(s) => [{ padding: 6, borderRadius: 8, cursor: 'pointer' }, isHovered(s) && { backgroundColor: t.chip }]}
                  >
                    <Icon name="close" color={t.faint} size={18} />
                  </Pressable>
                )}
              </Pressable>
            );
          })}
        </View>
      )}

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

      <Pressable
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
      </Pressable>

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
    </ScrollView>
  );
}
