import React from 'react';
import {
  BarChart as GiftedBarChart,
  LineChart as GiftedLineChart,
  PieChart as GiftedPieChart,
} from 'react-native-gifted-charts';

/**
 * Thin re-export of react-native-gifted-charts.
 *
 * Screens import from here rather than the library directly so LineChart
 * keeps one shared default (see below) — a leftover from when this module
 * also gated charts behind the "Show Charts & Graphs" setting, since
 * removed along with the rest of System Preferences.
 */

export const BarChart = GiftedBarChart;

type LineChartProps = React.ComponentProps<typeof GiftedLineChart>;
export function LineChart(props: LineChartProps) {
  // focusEnabled defaults on inside the library, wiring an onPressIn/onPressOut
  // pair onto each data point for a tap-to-focus tooltip nobody here uses.
  // react-native-web logs those as "Unknown event handler property" console
  // errors on its SVG host nodes; no call site passes pointerConfig or relies
  // on focus, so it's off by default here — pass focusEnabled explicitly to
  // opt a specific chart back in.
  return <GiftedLineChart focusEnabled={false} {...props} />;
}

export const PieChart = GiftedPieChart;
