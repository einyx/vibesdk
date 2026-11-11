import { Link } from 'react-router';
import { cn } from '@cloudflare/kumo';

/**
 * The live canvas: what the agent is doing right now.
 *
 * The home page used to be a prompt in the middle of a page. The product's
 * magic is the agent working — so the running build gets its own column, with
 * the plan, the file being written, and the live preview.
 *
 * Everything in here is a fact about the user's own app: the steps are
 * derived from what has actually happened, the files are the files the agent
 * wrote, and the picture is a render of the running preview. Nothing here is
 * a placeholder — a panel that lies about a build is worse than no panel.
 */

interface LiveStep {
	label: string;
	state: 'done' | 'run' | 'todo';
}

interface LiveFile {
	path: string;
	progress?: number;
}

interface LiveCanvasProps {
	appTitle?: string;
	/** When the app was last touched. */
	updatedAt?: string | null;
	steps?: LiveStep[];
	files?: LiveFile[];
	/** A render of the running preview. */
	screenshotUrl?: string | null;
	previewTitle?: string;
	/** Where "Open app" goes. */
	appHref?: string;
	className?: string;
}

function StepIcon({ state }: { state: LiveStep['state'] }) {
	if (state === 'done') {
		return (
			<span className="flex size-4 items-center justify-center rounded-full bg-kumo-success/15 text-[10px] text-kumo-success">
				✓
			</span>
		);
	}
	if (state === 'run') {
		return (
			<span className="flex size-4 items-center justify-center rounded-full bg-kumo-brand/15 text-[10px] text-kumo-brand">
				◆
			</span>
		);
	}
	return (
		<span className="flex size-4 items-center justify-center rounded-full bg-kumo-fill text-[10px] text-kumo-subtle">
			○
		</span>
	);
}

function Wave() {
	return (
		<span className="flex h-3 items-end gap-0.5" aria-hidden>
			{[5, 11, 7, 9].map((height, index) => (
				<span
					key={height}
					className="w-0.5 rounded-full bg-kumo-brand"
					style={{
						height,
						animation: `prysm-wave 0.9s ease-in-out ${index * 0.12}s infinite`,
					}}
				/>
			))}
		</span>
	);
}

export function LiveCanvas({
	appTitle,
	updatedAt,
	steps = [],
	files = [],
	screenshotUrl,
	previewTitle = 'Preview',
	appHref,
	className,
}: LiveCanvasProps) {
	// The pulse and the "live" claim only hold while a step is actually
	// running. Otherwise this is the last build, and it says so.
	const isRunning = steps.some((step) => step.state === 'run');

	return (
		<aside
			className={cn(
				'flex w-full shrink-0 flex-col gap-4 border-kumo-hairline bg-kumo-recessed p-5 lg:w-[380px] lg:border-l',
				className,
			)}
		>
			<div className="flex items-center gap-2">
				{isRunning ? (
					<span className="relative flex size-2">
						<span className="absolute inline-flex size-full animate-ping rounded-full bg-kumo-success opacity-60" />
						<span className="relative inline-flex size-2 rounded-full bg-kumo-success" />
					</span>
				) : (
					<span className="size-2 rounded-full bg-kumo-line" />
				)}
				<span className="text-sm font-semibold">
					{isRunning ? 'Live build' : 'Latest build'}
				</span>
				<span className="flex-1" />
				{appTitle ? (
					<span className="max-w-[45%] truncate text-xs text-kumo-subtle">
						{appTitle}
					</span>
				) : null}
			</div>

			{steps.length > 0 ? (
				<div className="rounded-lg border border-kumo-hairline bg-kumo-base p-4">
					<ul className="flex flex-col">
						{steps.map((step) => (
							<li
								key={step.label}
								className="flex items-center gap-2.5 py-1.5 text-sm"
							>
								<StepIcon state={step.state} />
								<span
									className={cn(
										step.state === 'todo'
											? 'text-kumo-subtle'
											: 'text-kumo-default',
									)}
								>
									{step.label}
								</span>
								{step.state === 'run' ? <span className="flex-1" /> : null}
								{step.state === 'run' ? <Wave /> : null}
							</li>
						))}
					</ul>
				</div>
			) : null}

			{files.length > 0 ? (
				<div className="rounded-lg border border-kumo-hairline bg-kumo-base p-4">
					<p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-kumo-subtle">
						files
					</p>
					<ul className="flex flex-col gap-1.5">
						{files.map((file) => (
							<li
								key={file.path}
								className="flex items-center gap-2 font-mono text-xs"
							>
								<span className="flex-1 truncate text-kumo-default">
									{file.path}
								</span>
								{typeof file.progress === 'number' ? (
									<span className="h-1 w-20 overflow-hidden rounded-full bg-kumo-fill">
										<span
											className="block h-full rounded-full bg-kumo-brand"
											style={{ width: `${file.progress}%` }}
										/>
									</span>
								) : null}
							</li>
						))}
					</ul>
				</div>
			) : null}

			<div className="overflow-hidden rounded-lg border border-kumo-hairline bg-kumo-base">
				<div className="flex items-center gap-2 border-b border-kumo-hairline px-3 py-2">
					<span className="font-mono text-[11px] text-kumo-subtle">
						preview
					</span>
				</div>
				{screenshotUrl ? (
					<img
						src={screenshotUrl}
						alt={`${previewTitle} preview`}
						className="aspect-[16/10] w-full bg-kumo-recessed object-cover"
					/>
				) : (
					<p className="px-4 py-6 text-center text-sm text-kumo-subtle">
						No preview captured yet.
					</p>
				)}
				<div className="flex items-center justify-between gap-2 border-t border-kumo-hairline px-3 py-2">
					<span className="min-w-0 truncate text-sm font-semibold">
						{previewTitle}
					</span>
					{updatedAt ? (
						<span className="shrink-0 text-xs text-kumo-subtle">
							{updatedAt}
						</span>
					) : null}
				</div>
			</div>

			{appHref ? (
				<Link
					to={appHref}
					className="text-xs text-kumo-subtle transition-colors hover:text-kumo-default"
				>
					Open app →
				</Link>
			) : (
				<Link
					to="/apps"
					className="text-xs text-kumo-subtle transition-colors hover:text-kumo-default"
				>
					See all your apps →
				</Link>
			)}
		</aside>
	);
}
