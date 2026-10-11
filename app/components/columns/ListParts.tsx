// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Pagination } from "@cloudflare/kumo";
import type { ReactNode } from "react";

export function ThreadListSkeleton() {
	return (
		<div className="animate-pulse">
			{Array.from({ length: 6 }).map((_, i) => (
				<div key={i} className="px-6 py-4 border-b border-kumo-line space-y-2">
					<div className="flex justify-between">
						<div className="h-3 w-28 rounded bg-kumo-fill" />
						<div className="h-3 w-12 rounded bg-kumo-fill" />
					</div>
					<div className="h-3 w-48 rounded bg-kumo-fill" />
					<div className="h-2.5 w-full rounded bg-kumo-fill" />
				</div>
			))}
		</div>
	);
}

export function ListEmptyState({
	icon,
	title,
	description,
	action,
}: {
	icon: ReactNode;
	title: string;
	description: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center py-20 px-6 text-center">
			<div className="mb-3">{icon}</div>
			<h3 className="text-sm font-semibold text-kumo-default mb-1">{title}</h3>
			<p className="text-[13px] text-kumo-subtle max-w-xs mb-4">{description}</p>
			{action}
		</div>
	);
}

export function ListPagination(props: {
	page: number;
	setPage: (page: number) => void;
	perPage: number;
	totalCount: number;
}) {
	if (props.totalCount <= props.perPage) return null;
	return (
		<div className="flex justify-center py-3 border-t border-kumo-line">
			<Pagination {...props} />
		</div>
	);
}
