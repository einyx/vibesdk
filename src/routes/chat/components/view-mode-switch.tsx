import { cn } from '@cloudflare/kumo';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, Code, FileText, Presentation, Database, GitBranch } from 'lucide-react';
import { featureRegistry } from '@/features';
import type { ProjectType } from '@/api-types';

// Map icon names to components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
	Eye,
	Presentation,
};

export function ViewModeSwitch({
	view,
	onChange,
	previewAvailable = false,
	showTooltip = false,
	hasDocumentation = false,
	previewUrl,
	projectType,
	databaseAvailable = false,
	repoAvailable = false,
}: {
	view: 'preview' | 'editor' | 'docs' | 'blueprint' | 'presentation' | 'database' | 'repo'
	onChange: (mode: 'preview' | 'editor' | 'docs' | 'blueprint' | 'presentation' | 'database' | 'repo') => void;
	previewAvailable: boolean;
	showTooltip: boolean;
	hasDocumentation: boolean;
	previewUrl?: string;
	projectType?: ProjectType;
	/** When true, the read-only DB viewer tab is shown. Wired only for think-behavior apps. */
	databaseAvailable?: boolean;
	/** When true, the read-only Artifacts repo viewer tab is shown. Wired only for think-behavior apps. */
	repoAvailable?: boolean;
}) {
	// Get feature definition to determine icon and label
	const featureDefinition = projectType ? featureRegistry.getDefinition(projectType) : null;

	// Get the preview view definition to find the icon
	const featureModule = projectType ? featureRegistry.getModule(projectType) : null;
	const views = featureModule?.getViews() ?? [];
	const previewView = views.find(v => v.id === 'preview');
	const iconName = previewView?.iconName;
	const PreviewIcon = (iconName && ICON_MAP[iconName]) || Eye;

	if (!previewAvailable) {
		return null;
	}

	return (
		<div className="relative flex items-center gap-4">
			<AnimatePresence>
				{showTooltip && (
					<motion.div
						initial={{ opacity: 0, scale: 0.4 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0 }}
						className="absolute z-50 top-10 left-0 bg-kumo-elevated text-text-primary text-xs px-2 py-1 rounded whitespace-nowrap animate-fade-in"
					>
						You can view code anytime from here
					</motion.div>
				)}
			</AnimatePresence>

			{/* Preview button - show when app has preview URL */}
			{previewUrl && (
				<button
					onClick={() => onChange('preview')}
					className={cn(
						'flex items-center justify-between px-0.5 pb-1 pt-1 transition-colors',
						view === 'preview' || view === 'presentation'
							? 'text-kumo-default border-b-2 border-kumo-brand -mb-px'
							: 'text-kumo-subtle hover:text-kumo-default border-b-2 border-transparent -mb-px',
					)}
					title={featureDefinition?.name ?? 'Preview'}
				>
					<PreviewIcon className="size-4" />
				</button>
			)}

			<button
				onClick={() => onChange('editor')}
				className={cn(
					'flex items-center justify-between px-0.5 pb-1 pt-1 transition-colors',
					view === 'editor'
						? 'text-kumo-default border-b-2 border-kumo-brand -mb-px'
						: 'text-kumo-subtle hover:text-kumo-default border-b-2 border-transparent -mb-px',
				)}
				title="Code"
			>
				<Code className="size-4" />
			</button>

			{/* Docs button - show when documentation exists */}
			{hasDocumentation && (
				<button
					onClick={() => onChange('docs')}
					className={cn(
						'flex items-center justify-between px-0.5 pb-1 pt-1 transition-colors',
						view === 'docs'
							? 'text-kumo-default border-b-2 border-kumo-brand -mb-px'
							: 'text-kumo-subtle hover:text-kumo-default border-b-2 border-transparent -mb-px',
					)}
					title="Docs"
				>
					<FileText className="size-4" />
				</button>
			)}
			{/* Database button - think-behavior apps get a singleton env.DB
			    backed by a SpaceDO Facet. Read-only viewer. */}
			{databaseAvailable && (
				<button
					onClick={() => onChange('database')}
					className={cn(
						'flex items-center justify-between px-0.5 pb-1 pt-1 transition-colors',
						view === 'database'
							? 'text-kumo-default border-b-2 border-kumo-brand -mb-px'
							: 'text-kumo-subtle hover:text-kumo-default border-b-2 border-transparent -mb-px',
					)}
					title="Database (read-only)"
				>
					<Database className="size-4" />
				</button>
			)}
			{/* Repo button - read-only viewer for the app's Cloudflare
			    Artifacts repository (durable git history). */}
			{repoAvailable && (
				<button
					onClick={() => onChange('repo')}
					className={cn(
						'flex items-center justify-between px-0.5 pb-1 pt-1 transition-colors',
						view === 'repo'
							? 'text-kumo-default border-b-2 border-kumo-brand -mb-px'
							: 'text-kumo-subtle hover:text-kumo-default border-b-2 border-transparent -mb-px',
					)}
					title="Repository (read-only)"
				>
					<GitBranch className="size-4" />
				</button>
			)}
			{/* {terminalAvailable && (
				<button
					onClick={() => onChange('terminal')}
					className={cn(
						'flex items-center justify-between px-0.5 pb-1 pt-1 transition-colors',
						view === 'terminal'
							? 'text-kumo-default border-b-2 border-kumo-brand -mb-px'
							: 'text-kumo-subtle hover:text-kumo-default border-b-2 border-transparent -mb-px',
					)}
					title="Terminal"
				>
					<Terminal className="size-4" />
				</button>
			)} */}
		</div>
	);
}
