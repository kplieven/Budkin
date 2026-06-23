import type { WidgetSnapshot } from '@/widgets/snapshot';

// No-op on non-Android platforms.
export async function pushWidgetUpdate(_snapshot: WidgetSnapshot): Promise<void> {}
