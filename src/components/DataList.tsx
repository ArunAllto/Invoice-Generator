/**
 * The virtualised list used by the Documents and Clients screens.
 *
 * §11 requires "1,000 documents scroll at 60 fps (`FlashList` or virtualised `FlatList`)" —
 * either is acceptable, which is what makes this wrapper legitimate rather than a compromise.
 *
 * It prefers `FlashList` and falls back to React Native's own `FlatList` when FlashList's
 * native module is not present in the running runtime. That happens in Expo Go, which ships a
 * fixed set of native modules; without the fallback the two list screens would crash there and
 * the app could only be reviewed from a full build. Both are virtualised, so the fallback is a
 * performance difference, not a correctness one.
 */

import React from 'react';
import { FlatList, type ListRenderItemInfo, type StyleProp, type ViewStyle } from 'react-native';

export interface DataListProps<T> {
  data: readonly T[];
  keyExtractor: (item: T) => string;
  renderItem: (info: ListRenderItemInfo<T>) => React.ReactElement;
  ItemSeparatorComponent?: React.ComponentType | null;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Rough row height. FlashList v2 measures for itself; FlatList uses it as a hint. */
  estimatedItemSize?: number;
}

/**
 * Resolve FlashList once, at module load.
 *
 * `require` rather than `import` because a static import would make the module a hard
 * dependency of the bundle graph and defeat the point. If anything about the resolution throws
 * — module missing, native side absent — we quietly take FlatList.
 */
const FlashListComponent: React.ComponentType<Record<string, unknown>> | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate soft dependency
    const module = require('@shopify/flash-list') as {
      FlashList?: React.ComponentType<Record<string, unknown>>;
    };
    return module.FlashList ?? null;
  } catch {
    return null;
  }
})();

export function isUsingFlashList(): boolean {
  return FlashListComponent !== null;
}

export function DataList<T>({
  data,
  keyExtractor,
  renderItem,
  ItemSeparatorComponent,
  contentContainerStyle,
  estimatedItemSize,
}: DataListProps<T>): React.ReactElement {
  if (FlashListComponent) {
    return (
      <FlashListComponent
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={ItemSeparatorComponent}
        contentContainerStyle={contentContainerStyle}
      />
    );
  }

  return (
    <FlatList
      data={data as T[]}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ItemSeparatorComponent={ItemSeparatorComponent}
      contentContainerStyle={contentContainerStyle}
      // Virtualisation settings that keep a long list smooth on a mid-range phone.
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={11}
      removeClippedSubviews
      getItemLayout={
        estimatedItemSize
          ? (_data, index) => ({
              length: estimatedItemSize,
              offset: estimatedItemSize * index,
              index,
            })
          : undefined
      }
    />
  );
}
