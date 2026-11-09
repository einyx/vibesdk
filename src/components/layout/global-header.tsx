import { useEffect, useState } from 'react';
import { SidebarTrigger, cn, useSidebar } from '@cloudflare/kumo';
import { useAuth } from '@/contexts/auth-context';
import { AlertCircle } from 'lucide-react';
import { SignInIcon } from '@phosphor-icons/react';
import { usePlatformStatus } from '@/hooks/use-platform-status';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OrangeButton } from '@/components/shared/OrangeButton';
import { useAuthModal } from '../auth/AuthModalProvider';
import { useHeaderContent } from './header-context';
import { PrysmMark } from '@/components/brand/prysm-brand';

/**
 * The topbar: a floating strip over the canvas.
 *
 * It is not a bar with a rule under it. The hairline fades out at both edges,
 * the app's identity sits at the left, the page's own view tabs (supplied by
 * the page through `HeaderProvider`) sit next to it, and the right side holds
 * exactly one filled action — everything else is quiet text or an icon.
 */
export function GlobalHeader() {
	const { user, isLoading: authLoading } = useAuth();
	const { showAuthModal } = useAuthModal();
	const { isMobile } = useSidebar();
	const { content } = useHeaderContent();
	const { status } = usePlatformStatus();
	const [isChangelogOpen, setIsChangelogOpen] = useState(false);
	const hasMaintenanceMessage = Boolean(
		status.hasActiveMessage && status.globalUserMessage.trim().length > 0,
	);
	const hasChangeLogs = Boolean(
		status.changeLogs && status.changeLogs.trim().length > 0,
	);
	const hasPageContent = Boolean(content?.leading || content?.trailing);

	useEffect(() => {
		if (!hasChangeLogs) {
			setIsChangelogOpen(false);
		}
	}, [hasChangeLogs]);

	return (
		<>
			<header className="sticky top-0 z-30">
				<div className="relative flex h-13 items-center gap-3 bg-kumo-canvas/70 px-4 backdrop-blur-xl md:px-5">
					{isMobile ? (
						<SidebarTrigger
							aria-label="Toggle navigation"
							className="shrink-0"
						/>
					) : null}

					<div className="flex min-w-0 flex-1 items-center gap-3">
						{content?.leading ?? (
							<>
								<span
									className="flex size-5 shrink-0 items-center justify-center text-kumo-brand"
									aria-hidden
								>
									<PrysmMark className="size-[18px]" />
								</span>
								{!hasPageContent && hasMaintenanceMessage ? (
									<button
										type="button"
										onClick={
											hasChangeLogs
												? () => setIsChangelogOpen(true)
												: undefined
										}
										disabled={!hasChangeLogs}
										className={cn(
											'flex max-w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-kumo-default transition-colors hover:bg-kumo-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand/40',
											!hasChangeLogs &&
												'opacity-50 cursor-not-allowed pointer-events-none',
										)}
										aria-label="Platform updates"
									>
										<AlertCircle className="h-4 w-4 text-kumo-brand" />
										<span className="truncate max-w-[46ch] md:max-w-[60ch]">
											{status.globalUserMessage}
										</span>
									</button>
								) : null}
							</>
						)}
					</div>

					<div className="flex shrink-0 items-center justify-end gap-2">
						{content?.trailing}
						{!authLoading && !user && (
							<OrangeButton
								size="sm"
								onClick={() => showAuthModal()}
								icon={<SignInIcon className="size-4" />}
							>
								Sign In
							</OrangeButton>
						)}
					</div>

					<div
						aria-hidden
						className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-transparent via-kumo-hairline to-transparent md:inset-x-5"
					/>
				</div>
			</header>

			<Dialog open={isChangelogOpen} onOpenChange={setIsChangelogOpen}>
				{hasChangeLogs && (
					<DialogContent className="max-w-xl">
						<DialogHeader>
							<DialogTitle>Platform updates</DialogTitle>
							{status.globalUserMessage && (
								<DialogDescription className="text-sm text-kumo-subtle">
									{status.globalUserMessage}
								</DialogDescription>
							)}
						</DialogHeader>
						<ScrollArea className="max-h-[60vh] pr-4">
							<p className="whitespace-pre-wrap text-sm leading-relaxed text-kumo-subtle">
								{status.changeLogs}
							</p>
						</ScrollArea>
					</DialogContent>
				)}
			</Dialog>
		</>
	);
}
