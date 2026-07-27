"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";

type DeltaIconVariant = "default" | "trend" | "arrow";
type DeltaVariant = "default" | "badge";

type DeltaContextValue = {
	value: number;
};

const DeltaContext = React.createContext<DeltaContextValue | null>(null);

function useDeltaValue() {
	const context = React.useContext(DeltaContext);
	if (!context) {
		throw new Error(
			"DeltaIcon and DeltaValue must be used inside a `Delta` component."
		);
	}
	return context.value;
}

function Delta({
	className,
	value,
	variant = "default",
	children,
	...props
}: React.ComponentProps<"div"> & {
	value: number;
	variant?: DeltaVariant;
}) {
	return (
		<DeltaContext.Provider value={{ value }}>
			{variant === "badge" ? (
				<Badge
					className={`gap-1 border-none tabular-nums ${
						value > 0
							? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
							: "bg-red-500/10 text-rose-600 dark:text-rose-400"
					} ${className || ""}`}
					data-slot="delta"
					variant="secondary"
					{...(props as any)}
				>
					{children}
				</Badge>
			) : (
				<div
					className={`inline-flex items-center gap-1 text-xs tabular-nums font-medium ${
						value > 0 ? "text-emerald-600 dark:text-emerald-400" : ""
					} ${value < 0 ? "text-rose-600 dark:text-rose-400" : ""} ${className || ""}`}
					data-slot="delta"
					{...props}
				>
					{children}
				</div>
			)}
		</DeltaContext.Provider>
	);
}

function DeltaIcon({
	variant = "arrow",
	className,
}: {
	variant?: DeltaIconVariant;
	className?: string;
}) {
	const value = useDeltaValue();
	if (value > 0) {
		return (
			<svg className={`w-3 h-3 ${className || ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
			</svg>
		);
	}
	return (
		<svg className={`w-3 h-3 ${className || ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
			<path strokeLinecap="round" strokeLinejoin="round" d="M4.5 4.5l15 15m0 0V8.25m0 11.25H8.25" />
		</svg>
	);
}

function DeltaValue({
	precision = 1,
	suffix = "%",
	absolute = true,
}: {
	precision?: number;
	suffix?: string;
	absolute?: boolean;
}) {
	const value = useDeltaValue();
	const formatted = (absolute ? Math.abs(value) : value).toFixed(precision);
	return <span className="tabular-nums">{formatted}{suffix}</span>;
}

export { Delta, DeltaIcon, DeltaValue };
