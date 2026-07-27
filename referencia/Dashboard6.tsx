"use client";

import React, { useState } from "react";
import {
  LayoutDashboard,
  Calendar,
  Flag,
  BarChart2,
  Users,
  Layers,
  ChevronDown,
  Calendar as CalendarIcon,
  SlidersHorizontal,
  MoreHorizontal,
  Sparkles,
  Send
} from "lucide-react";
import { Dashboard6Stats } from "@/components/dashboard-6/stats";
import { MrrChart } from "@/components/dashboard-6/mrr-chart";
import { TotalRevenueGauge, ActiveCustomersCard } from "@/components/dashboard-6/right-cards";

export default function Dashboard6() {
  const [period, setPeriod] = useState("Last 30 days");
  const [activeTab, setActiveTab] = useState("Dashboard");

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 font-sans antialiased flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-200 dark:border-slate-800 p-4 min-h-screen flex flex-col justify-between bg-white dark:bg-slate-900">
        <div>
          {/* Workspace Switcher */}
          <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 mb-6">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold">
                E
              </div>
              <span className="text-sm font-medium">Efferd LLC</span>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </div>

          {/* Nav Links */}
          <nav className="space-y-1">
            {[
              { label: "Dashboard", icon: LayoutDashboard },
              { label: "Content Calendar", icon: Calendar },
              { label: "Campaigns", icon: Flag },
              { label: "Analytics", icon: BarChart2 },
              { label: "Team", icon: Users },
              { label: "Integrations", icon: Layers },
            ].map(({ label, icon: Icon }) => (
              <button
                key={label}
                onClick={() => setActiveTab(label)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === label
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="space-y-4">
          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">UPDATE</span>
            <p className="text-xs font-medium mt-1">What's new</p>
            <p className="text-xs text-slate-500 mt-0.5">Latest fixes and new features.</p>
            <button className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline mt-2">
              Learn more
            </button>
          </div>

          <div className="flex items-center gap-3 p-1.5">
            <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-xs">
              SH
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate">Shaban Haider</p>
              <p className="text-[11px] text-slate-500 truncate">shaban@efferd.com</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 p-8 space-y-6 max-w-7xl">
        {/* Controls Bar */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Good afternoon</h1>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
              {period} <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
              <CalendarIcon className="w-3.5 h-3.5" /> Jun 27 - Jul 26, 2026
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
              <SlidersHorizontal className="w-3.5 h-3.5" /> Customize
            </button>
            <button className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Dashboard Content Grid */}
        <div className="grid grid-cols-12 gap-6">
          {/* Main 8-col Section */}
          <div className="col-span-8 space-y-6">
            <Dashboard6Stats />
            <MrrChart />

            {/* AI Insights & Budget */}
            <div className="grid grid-cols-2 gap-6">
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-6 bg-white dark:bg-slate-900 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Sparkles className="w-4 h-4 text-purple-500" /> AI Insights
                  </span>
                  <button className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1">
                    <Send className="w-3 h-3" /> Ask AI
                  </button>
                </div>
                <p className="text-lg font-medium leading-snug mt-6">
                  Unused budget runway improved by{" "}
                  <span className="font-bold text-slate-900 dark:text-white">3.5% this month</span> vs.
                  trailing burn.
                </p>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-6 bg-white dark:bg-slate-900 shadow-sm space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Budget usage</span>
                  <span className="text-xs font-semibold text-slate-900 dark:text-white">$50,734</span>
                </div>
                <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                  <div className="h-full bg-slate-900 dark:bg-slate-100" style={{ width: "50%" }}></div>
                  <div className="h-full bg-slate-400" style={{ width: "25%" }}></div>
                  <div className="h-full bg-slate-200 dark:bg-slate-700" style={{ width: "25%" }}></div>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                  <span className="flex items-center gap-1 font-medium">
                    <span className="w-2 h-2 rounded-full bg-slate-900 dark:bg-slate-100"></span> Unused 50%
                  </span>
                  <span className="flex items-center gap-1 font-medium">
                    <span className="w-2 h-2 rounded-full bg-slate-400"></span> Used 25%
                  </span>
                  <span className="flex items-center gap-1 font-medium">
                    <span className="w-2 h-2 rounded-full bg-slate-200 dark:bg-slate-700"></span> Reserved 25%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right 4-col Section */}
          <div className="col-span-4 space-y-6">
            <TotalRevenueGauge />
            <ActiveCustomersCard />
          </div>
        </div>
      </main>
    </div>
  );
}
