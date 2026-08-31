import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  BarChart as GiftedBarChart,
  LineChart as GiftedLineChart,
  PieChart as GiftedPieChart,
} from 'react-native-gifted-charts';
import { BarChart3 } from 'lucide-react-native';
import { Colors, Radius } from '../constants/colors';
import { usePreferences } from '../contexts/PreferencesContext';

/**
 * Charts that respect the "Show Charts & Graphs" setting.
 *
 * Screens import these instead of react-native-gifted-charts directly, so the
 * preference is honoured everywhere by changing one import line per screen
 * rather than wrapping every chart at every call site — and a chart added later
 * is covered automatically.
 *
 * Turning charts off hides the drawing, never the data: the surrounding cards,
 * totals and legends stay exactly as they were, and the numbers behind them are
 * still fetched and still correct. This is a display preference for nurses who
 * find the graphs noisy, not a way to opt out of the underlying figures.
 */

function ChartsHidden() {
  return (
    <View style={styles.placeholder}>
      <BarChart3 size={18} color={Colors.mutedForeground} />
      <Text style={styles.placeholderText}>
        Charts are hidden. Turn them back on in Settings → System Preferences.
      </Text>
    </View>
  );
}

function useChartsVisible(): boolean {
  return usePreferences().preferences.showCharts;
}

type BarChartProps = React.ComponentProps<typeof GiftedBarChart>;
type LineChartProps = React.ComponentProps<typeof GiftedLineChart>;
type PieChartProps = React.ComponentProps<typeof GiftedPieChart>;

export function BarChart(props: BarChartProps) {
  const visible = useChartsVisible();
  if (!visible) return <ChartsHidden />;
  return <GiftedBarChart {...props} />;
}

export function LineChart(props: LineChartProps) {
  const visible = useChartsVisible();
  if (!visible) return <ChartsHidden />;
  return <GiftedLineChart {...props} />;
}

export function PieChart(props: PieChartProps) {
  const visible = useChartsVisible();
  if (!visible) return <ChartsHidden />;
  return <GiftedPieChart {...props} />;
}

const styles = StyleSheet.create({
  placeholder: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 28,
    paddingHorizontal: 16,
    backgroundColor: Colors.muted,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  placeholderText: {
    flexShrink: 1,
    fontSize: 12,
    color: Colors.mutedForeground,
  },
});
