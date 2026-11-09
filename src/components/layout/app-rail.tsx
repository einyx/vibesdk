import React from 'react';
import { Link, useLocation } from 'react-router';
import {
	CompassIcon,
	GridFourIcon,
	SparkleIcon,
} from '@phosphor-icons/react';
import { cn } from '@cloudflare/kumo';
import { PrysmMark } from '@/components/brand/prysm-brand';
import { useAuth } from '@/contexts/auth-context';

/**
 * The rail: the app's navigation, reduced to a column of marks.
 *
 * The builder is a canvas — the wide sidebar it replaces spent 320px on lists
 * that are mostly secondary while the agent works. The rail keeps every
 * destination one click away and gives the rest of the width to the work.
 */

interface RailItem {
	to: string;
	label: string;
	icon: React.ReactNode;
}

const items: RailItem[] = [
	{ to: '/', label: 'Build', icon: <SparkleIcon className="size-[18px]" weight="fill" /> },
	{ to: '/discover', label: 'Discover', icon: <CompassIcon className="size-[18px]" /> },
	{ to: '/apps', label: 'Apps', icon: <GridFourIcon className="size-[18px]" /> },
];

export function AppRail() {
	const { user } = useAuth();
	const location = useLocation();

	const isActive = (to: string) =>
		to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

	return (
		<nav
			aria-label="Primary"
			className="hidden h-full w-[68px] shrink-0 flex-col items-center gap-2 border-r border-kumo-hairline bg-kumo-recessed py-4 md:flex"
		>
			<Link
				to="/"
				aria-label="Prysm build"
				className="mb-3 flex size-9 items-center justify-center text-kumo-brand transition-opacity hover:opacity-80"
			>
				<PrysmMark className="size-6" />
			</Link>

			{items.map((item) => (
				<Link
					key={item.to}
					to={item.to}
					title={item.label}
					aria-label={item.label}
					aria-current={isActive(item.to) ? 'page' : undefined}
					className={cn(
						'relative flex size-10 items-center justify-center rounded-md text-kumo-subtle transition-colors',
						'hover:bg-kumo-elevated hover:text-kumo-default',
						isActive(item.to) &&
							'bg-kumo-elevated text-kumo-default ring-1 ring-kumo-hairline',
					)}
				>
					{item.icon}
					{isActive(item.to) ? (
						<span
							aria-hidden
							className="absolute -left-[15px] top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-r-full bg-kumo-brand"
						/>
					) : null}
				</Link>
			))}

			<div className="flex-1" />

			<Link
				to="/settings"
				title="Settings"
				aria-label="Settings"
				className={cn(
					'flex size-10 items-center justify-center rounded-md text-kumo-subtle transition-colors',
					'hover:bg-kumo-elevated hover:text-kumo-default',
					isActive('/settings') &&
						'bg-kumo-elevated text-kumo-default ring-1 ring-kumo-hairline',
				)}
			>
				<svg
					viewBox="0 0 24 24"
					className="size-[18px]"
					fill="none"
					stroke="currentColor"
					strokeWidth={1.7}
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden
				>
					<circle cx="12" cy="12" r="3" />
					<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.2.61.77 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
				</svg>
			</Link>

			{user ? (
				<Link
					to="/profile"
					title={user.email ?? 'Your profile'}
					aria-label="Your profile"
					className="mt-1 flex size-9 items-center justify-center rounded-full bg-kumo-brand text-xs font-semibold text-white"
				>
					{(user.email ?? '?').slice(0, 1).toUpperCase()}
				</Link>
			) : null}
		</nav>
	);
}
