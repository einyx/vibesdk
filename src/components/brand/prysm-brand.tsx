/**
 * The Prysm mark and wordmark.
 *
 * These are the brand files from `stacks/verity/prysm-landing/brand`, inlined
 * as components so the app ships one copy of the brand and the theme can pick
 * the right colour per canvas: `#e0705a` on dark, `#a8482f` on light.
 *
 * The brand README is explicit: "do not redraw the mark".
 */

interface PrysmMarkProps {
	className?: string;
}

/** The mark: a chevron — an upward stroke crossed by two diagonals. */
export function PrysmMark({ className }: PrysmMarkProps) {
	return (
		<svg
			viewBox="0 0 32 32"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.8}
			strokeLinejoin="round"
			role="img"
			aria-label="Prysm"
			className={className}
		>
			<path d="M4 26 16 5l12 21H4Zm12-21v21M4 26l18-10" />
		</svg>
	);
}

/** The wordmark: lowercase `prysm`, drawn as outlines so it renders identically without Inter. */
export function PrysmWordmark({ className }: PrysmMarkProps) {
	return (
		<svg
			viewBox="0 0 54.63 25.08"
			role="img"
			aria-label="Prysm"
			className={className}
		>
			<g fill="currentColor" transform="scale(0.009277)">
				<path
					transform="translate(0.00 0)"
					d="M148 -418H368V175H380C419 104 500 -22 703 -22C975 -22 1170 195 1170 556C1170 920 971 1132 703 1132C494 1132 419 1005 380 936H362V1118H148ZM654 165C468 165 364 325 364 558C364 790 465 945 654 945C848 945 945 778 945 558C945 336 845 165 654 165Z"
				/>
				<path
					transform="translate(1212.11 0)"
					d="M148 0H368V679C368 826 480 930 634 930C680 930 733 922 749 918V1128C726 1131 684 1134 656 1134C525 1134 414 1060 373 938H361V1118H148Z"
				/>
				<path
					transform="translate(1950.21 0)"
					d="M133 -402C160 -414 218 -426 287 -426C467 -426 578 -334 646 -155L1132 1118H896L671 483C636 386 611 289 586 193C562 289 539 385 505 483L284 1118H46L471 -5L447 -87C406 -231 326 -259 212 -229L187 -223Z"
				/>
				<path
					transform="translate(3074.32 0)"
					d="M549 -23C822 -23 1010 121 1010 325C1010 480 912 580 705 627L525 667C402 695 352 739 352 813C352 897 444 958 565 958C697 958 760 888 789 810L986 853C938 1019 805 1132 563 1132C310 1132 130 999 130 799C130 639 230 537 438 490L626 447C732 423 783 377 783 306C783 223 693 155 551 155C421 155 336 209 305 326L98 283C138 85 306 -23 549 -23Z"
				/>
				<path
					transform="translate(4123.42 0)"
					d="M148 0H368V695C368 858 474 944 597 944C715 944 801 865 801 746V0H1018V716C1018 849 1102 944 1241 944C1355 944 1451 881 1451 732V0H1671V754C1671 1008 1515 1137 1317 1137C1158 1137 1020 1053 963 902C919 1050 823 1137 677 1137C544 1137 419 1064 362 909L357 1118H148Z"
				/>
			</g>
			<circle cx="56.83" cy="16.34" r="1.6" fill="var(--color-kumo-brand)" />
		</svg>
	);
}
