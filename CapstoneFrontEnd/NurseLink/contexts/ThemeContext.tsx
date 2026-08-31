import React, { createContext, useContext, useMemo } from 'react';
import { Colors } from '../constants/colors';
import { usePreferences } from './PreferencesContext';

/**
 * Appearance, resolved from the nurse's saved settings.
 *
 * Two controls feed into one object: a font scale and a spacing scale for
 * compact view. Screens read them here rather than hard-coding sizes, which is
 * what makes the settings take effect instead of merely being stored.
 *
 * The palette is exposed alongside them and is always the single light clinical
 * theme. It stays on the theme object rather than being imported directly by
 * screens so that colour, font size and density are read from one place.
 *
 * A note on how this has to be used. React Native resolves `StyleSheet.create`
 * once, when the module is first imported — so a stylesheet written at the top
 * of a file captures whatever the colours were at startup and can never change
 * afterwards. Themed screens therefore build their styles inside the component:
 *
 *     const { theme, scale, space } = useTheme();
 *     const styles = useMemo(() => createStyles(theme, scale, space), [theme, scale, space]);
 *
 * The useMemo matters: without it every render rebuilds every style object and
 * defeats the equality checks that stop children re-rendering.
 */

export interface Theme {
  /** The active palette. */
  colors: typeof Colors;
  /** Multiply font sizes by this. */
  scale: (size: number) => number;
  /** Multiply padding, margin and gap by this. */
  space: (size: number) => number;
  fontScale: number;
  spaceScale: number;
}

// Deliberately gentle. Large has to help a tired nurse read a vitals card
// without pushing a two-column layout into overflow.
const FONT_SCALES: Record<string, number> = {
  small: 0.9,
  medium: 1,
  large: 1.15,
};

// Compact view tightens the gaps rather than shrinking the text, so more fits
// on screen without anything becoming harder to read.
const COMPACT_SPACE_SCALE = 0.7;

const ThemeContext = createContext<Theme | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { preferences } = usePreferences();
  const { fontSize, compactView } = preferences;

  const value = useMemo<Theme>(() => {
    const fontScale = FONT_SCALES[fontSize] ?? 1;
    const spaceScale = compactView ? COMPACT_SPACE_SCALE : 1;

    return {
      colors: Colors,
      fontScale,
      spaceScale,
      // Rounded: fractional font sizes render blurry on some Android devices.
      scale: (size: number) => Math.round(size * fontScale),
      space: (size: number) => Math.round(size * spaceScale),
    };
  }, [fontSize, compactView]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): Theme {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
