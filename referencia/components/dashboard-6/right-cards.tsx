"use client";

import React from "react";

export function TotalRevenueGauge() {
  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-6 bg-white dark:bg-slate-900 shadow-sm text-center space-y-4">
      <div className="relative flex items-center justify-center h-44">
        {/* Circular Segmented Gauge Visual */}
        <svg className="w-44 h-44 transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="currentColor"
            strokeWidth="8"
            className="text-slate-100 dark:text-slate-800"
            fill="transparent"
            strokeDasharray="180 250"
          />
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="currentColor"
            strokeWidth="8"
            className="text-slate-800 dark:text-slate-200"
            fill="transparent"
            strokeDasharray="130 250"
          />
        </svg>
        <div className="absolute text-center">
          <span className="text-xs text-slate-400 font-medium">Total Revenue</span>
          <p className="text-xl font-bold text-slate-900 dark:text-white">$284,920.00</p>
        </div>
      </div>
      <div className="flex items-center justify-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-2 h-2 rounded-full bg-slate-800 dark:bg-slate-200"></span> Subscriptions
        </span>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-700"></span> Usage & services
        </span>
      </div>
      <button className="w-full py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 transition">
        View Detail →
      </button>
    </div>
  );
}

export function ActiveCustomersCard() {
  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-6 bg-white dark:bg-slate-900 shadow-sm space-y-4">
      <p className="text-xs text-slate-500 font-medium">Active customers</p>
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">2,540</span>
        <span className="text-xs text-slate-500 font-medium">78% Paid</span>
      </div>
      <div className="flex items-end gap-1 h-12 pt-2">
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            className={`flex-1 rounded-sm ${
              i < 23 ? "bg-slate-800 dark:bg-slate-200" : "bg-slate-200 dark:bg-slate-700"
            }`}
            style={{ height: `${30 + (i % 5) * 14}%` }}
          ></div>
        ))}
      </div>
    </div>
  );
}
