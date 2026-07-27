"use client";

import React from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";

type MrrRow = {
  date: string;
  day: string;
  mrr: number;
  formatted: string;
};

const mrrChartData: MrrRow[] = [
  { date: "Apr 10", day: "Fri", mrr: 62000, formatted: "$62K" },
  { date: "Apr 12", day: "Sun", mrr: 68000, formatted: "$68K" },
  { date: "Apr 14", day: "Tue", mrr: 74000, formatted: "$74K" },
  { date: "Apr 16", day: "Thu", mrr: 76000, formatted: "$76K" },
  { date: "Apr 19", day: "Sun", mrr: 78000, formatted: "$78K" },
  { date: "Apr 21", day: "Tue", mrr: 77000, formatted: "$77K" },
  { date: "Apr 23", day: "Thu", mrr: 80000, formatted: "$80K" },
  { date: "Apr 25", day: "Sat", mrr: 82000, formatted: "$82K" },
  { date: "Apr 28", day: "Tue", mrr: 85000, formatted: "$85K" },
  { date: "May 1",  day: "Fri", mrr: 84000, formatted: "$84K" },
  { date: "May 4",  day: "Mon", mrr: 89000, formatted: "$89K" },
  { date: "May 9",  day: "Sat", mrr: 92000, formatted: "$92K" },
];

const RechartsExactTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as MrrRow;
    return (
      <div className="bg-white dark:bg-slate-900 p-3 rounded-xl shadow-xl border border-slate-200/80 dark:border-slate-800 min-w-[140px]">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
          {data.day}, {data.date}
        </p>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-600 dark:bg-slate-300"></span>
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">MRR</span>
          </div>
          <span className="text-sm font-bold text-slate-900 dark:text-white">
            {data.formatted}
          </span>
        </div>
      </div>
    );
  }
  return null;
};

export function MrrChart() {
  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-6 bg-white dark:bg-slate-900 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">$92K</h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">Monthly recurring revenue</p>
        </div>
        <Delta value={27.4} variant="badge">
          <DeltaIcon />
          <DeltaValue suffix="% over last 30 days" />
        </Delta>
      </div>

      <div className="h-64 w-full pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={mrrChartData}>
            <defs>
              <linearGradient id="efferdMrrGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#64748b" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#64748b" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              stroke="#94a3b8"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#94a3b8"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => `$${val / 1000}k`}
            />
            <Tooltip content={<RechartsExactTooltip />} />
            <Area
              type="monotone"
              dataKey="mrr"
              stroke="#475569"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#efferdMrrGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
