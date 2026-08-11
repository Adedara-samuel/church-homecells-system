'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCompactMoney, formatMoney, formatNumber } from '@/lib/utils';

/**
 * A five-colour categorical ramp taken from the theme tokens, so charts follow the
 * light/dark palette rather than carrying their own hard-coded colours.
 */
export const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

const AXIS_STYLE = {
  fontSize: 11,
  fill: 'hsl(var(--muted-foreground))',
};

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  valueFormatter: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover p-3 text-xs shadow-md">
      {label && <p className="mb-2 font-medium text-popover-foreground">{label}</p>}
      <ul className="space-y-1">
        {payload.map((entry, index) => (
          <li key={index} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
                aria-hidden
              />
              {entry.name}
            </span>
            <span className="font-medium tabular text-popover-foreground">
              {typeof entry.value === 'number' ? valueFormatter(entry.value) : entry.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface SeriesConfig {
  key: string;
  label: string;
  color?: string;
}

export interface ChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesConfig[];
  height?: number;
  /** Money series are formatted with the currency symbol and compact axis labels. */
  currency?: string;
  emptyMessage?: string;
}

function EmptyChart({ message, height }: { message: string; height: number }) {
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"
    >
      {message}
    </div>
  );
}

export function TrendLineChart({
  data,
  xKey,
  series,
  height = 300,
  emptyMessage = 'No data for this period yet',
}: ChartProps) {
  if (!data?.length) return <EmptyChart message={emptyMessage} height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} />
        <YAxis
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => formatNumber(value)}
          width={48}
        />
        <Tooltip content={<ChartTooltip valueFormatter={formatNumber} />} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
        />
        {series.map((s, index) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? CHART_COLORS[index % CHART_COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MoneyBarChart({
  data,
  xKey,
  series,
  height = 300,
  currency = 'NGN',
  emptyMessage = 'No financial activity for this period yet',
}: ChartProps) {
  if (!data?.length) return <EmptyChart message={emptyMessage} height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} />
        <YAxis
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          width={60}
          tickFormatter={(value: number) => formatCompactMoney(value, currency)}
        />
        <Tooltip
          cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
          content={<ChartTooltip valueFormatter={(v) => formatMoney(v, currency)} />}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        {series.map((s, index) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color ?? CHART_COLORS[index % CHART_COLORS.length]}
            radius={[4, 4, 0, 0]}
            maxBarSize={44}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DistributionBarChart({
  data,
  xKey,
  valueKey,
  label,
  height = 300,
  emptyMessage = 'No members recorded yet',
}: {
  data: Record<string, unknown>[];
  xKey: string;
  valueKey: string;
  label: string;
  height?: number;
  emptyMessage?: string;
}) {
  if (!data?.length) return <EmptyChart message={emptyMessage} height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey={xKey}
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          width={120}
        />
        <Tooltip
          cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
          content={<ChartTooltip valueFormatter={formatNumber} />}
        />
        <Bar dataKey={valueKey} name={label} radius={[0, 4, 4, 0]} maxBarSize={26}>
          {data.map((_, index) => (
            <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SharePieChart({
  data,
  nameKey,
  valueKey,
  height = 280,
  emptyMessage = 'No data to display',
}: {
  data: Record<string, unknown>[];
  nameKey: string;
  valueKey: string;
  height?: number;
  emptyMessage?: string;
}) {
  const total = data.reduce((sum, row) => sum + Number(row[valueKey] ?? 0), 0);
  if (!data?.length || total === 0) return <EmptyChart message={emptyMessage} height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={2}
          strokeWidth={0}
        >
          {data.map((_, index) => (
            <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip valueFormatter={formatNumber} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function AttendanceAreaChart({
  data,
  xKey,
  series,
  height = 300,
  emptyMessage = 'No attendance recorded for this period yet',
}: ChartProps) {
  if (!data?.length) return <EmptyChart message={emptyMessage} height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <defs>
          {series.map((s, index) => (
            <linearGradient key={s.key} id={`gradient-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor={s.color ?? CHART_COLORS[index % CHART_COLORS.length]}
                stopOpacity={0.35}
              />
              <stop
                offset="95%"
                stopColor={s.color ?? CHART_COLORS[index % CHART_COLORS.length]}
                stopOpacity={0}
              />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={44} />
        <Tooltip content={<ChartTooltip valueFormatter={formatNumber} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        {series.map((s, index) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? CHART_COLORS[index % CHART_COLORS.length]}
            fill={`url(#gradient-${s.key})`}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
