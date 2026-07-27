"use client";

import React from "react";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";

type StatItem = {
  label: string;
  value: string;
  delta: number;
  comparisonText: string;
};

const stats: StatItem[] = [
  {
    label: "Repeat purchase rate",
    value: "38.4%",
    delta: 2.7,
    comparisonText: "vs prior 30 days",
  },
  {
    label: "Orders",
    value: "1,842",
    delta: 4.1,
    comparisonText: "vs prior 30 days",
  },
  {
    label: "Average order value",
    value: "$154.60",
    delta: -1.3,
    comparisonText: "vs prior 30 days",
  },
];

export function Dashboard6Stats() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 bg-white dark:bg-slate-900 shadow-sm">
      {stats.map((stat) => (
        <div key={stat.label} className="space-y-1">
          <p className="text-xs text-slate-500 font-medium">{stat.label}</p>
          <p className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            {stat.value}
          </p>
          <Delta value={stat.delta} className="mt-1">
            <DeltaIcon />
            <DeltaValue />
            <span className="text-slate-400 font-normal text-xs ml-1">
              {stat.comparisonText}
            </span>
          </Delta>
        </div>
      ))}
    </div>
  );
}
