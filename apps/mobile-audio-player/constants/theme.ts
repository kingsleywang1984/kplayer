/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

/**
 * Centralized text color tokens for consistent styling.
 * Use these instead of inline color literals.
 */
export const TextColors = {
  /** Main text - headings, titles, primary content */
  primary: '#fff',
  /** Subtitles, metadata, secondary info */
  secondary: 'rgba(255, 255, 255, 0.7)',
  /** Descriptions, hints, tertiary content */
  tertiary: 'rgba(255, 255, 255, 0.5)',
  /** Inactive/disabled states */
  muted: 'rgba(255, 255, 255, 0.6)',
};

/**
 * Surface/background colors for UI components.
 * NOTE: Do NOT use these for animation backgrounds (Galaxy3D, Wormhole, etc.)
 */
export const SurfaceColors = {
  /** Glass cards (player card, settings cards) */
  card: 'rgba(30, 30, 40, 0.3)',
  /** Modal overlays */
  modal: 'rgba(30, 30, 40, 0.9)',
  /** List items (tracks, groups) */
  listItem: 'rgba(255, 255, 255, 0.05)',
  /** Hover/active states, dividers */
  hover: 'rgba(255, 255, 255, 0.1)',
  /** Input fields */
  input: '#1e1e28',
};

/**
 * Border colors for UI components.
 */
export const BorderColors = {
  /** Subtle borders on cards/items */
  subtle: 'rgba(255, 255, 255, 0.1)',
  /** Active/selected state borders */
  active: '#fff',
};

/**
 * Status indicator colors.
 */
export const StatusColors = {
  /** Online, success states */
  success: '#34a853',
  /** Offline, error states */
  error: '#ea4335',
};

/**
 * Consistent spacing scale.
 */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

/**
 * Consistent border radius scale.
 */
export const BorderRadius = {
  /** Status dots, small elements */
  xs: 4,
  /** Buttons, thumbnails */
  sm: 8,
  /** Cards, list items */
  md: 12,
  /** Glass cards, settings cards */
  lg: 16,
  /** Modal containers */
  xl: 20,
  /** Player glass card */
  xxl: 24,
} as const;


export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
