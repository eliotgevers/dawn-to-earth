"use client";

import dynamic from "next/dynamic";
import type { ReactElement, ReactNode } from "react";
import type { ChartConfig } from "@/components/ui/chart";

type ChartParts = typeof import("recharts") & typeof import("@/components/ui/chart");
type Props = {
  config: ChartConfig;
  height: number;
  className: string;
  unavailable?: ReactNode;
  children: (charts: ChartParts) => ReactElement;
};

// Keep the chart bundle out of unopened records. The text and source tables render independently.
export const EvidenceChart = dynamic<Props>(async () => {
  try {
    const [charts, ui] = await Promise.all([import("recharts"), import("@/components/ui/chart")]);
    const parts = { ...charts, ...ui };
    return function LoadedChart({ config, height, className, children }: Props) {
      return <ui.ChartContainer config={config} className={className}>
        <charts.ResponsiveContainer initialDimension={{ width: 320, height }}>
          {children(parts)}
        </charts.ResponsiveContainer>
      </ui.ChartContainer>;
    };
  } catch {
    return ({ unavailable }: Props) => <>{unavailable}</>;
  }
}, { ssr: false });
