export const EASING = Object.freeze({
	standard: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
	easeOutCubic: 'cubic-bezier(0.215, 0.61, 0.355, 1)'
});

export const RAIL = Object.freeze({
	collapsedWidthPx: 64,
	expandedWidthPx: 196,
	leftInsetPx: 12,
	labelRevealStartProgress: 0.6,
	gestureZoneMarginPx: 24,
	animationMs: 240,
	animationMinMs: 120
});

export const PANEL = Object.freeze({
	slideDistancePx: 384,
	contentInsetPx: 376,
	snapMs: 240,
	snapMinMs: 120,
	transitionCleanupMarginMs: 40,
	tabInkBaseWidthPx: 10
});

export const GESTURE = Object.freeze({
	axisDecisionDistancePx: 8,
	minimumHorizontalDeltaPx: 0.5,
	mouseWheelStepThresholdPx: 60,
	silenceEndMs: 450,
	rowSilenceEndMs: 250,
	endHoldMs: 200,
	tailGapForNewGestureMs: 80,
	tailRisesForNewGesture: 2,
	snapToOpenProgress: 0.5
});

export const ROW_SWIPE = Object.freeze({
	commitOnSilenceProgress: 0.4,
	commitImmediatelyProgress: 0.7,
	fadeEndProgress: 0.55,
	fadeExponent: 1.6,
	rubberBandFactor: 0.25,
	rubberBandMaxPx: 6,
	exitDistanceFactor: 1.15,
	exitMs: 180,
	springBackMs: 220
});

export const MOTION = Object.freeze({
	viewEnterMs: 320,
	viewEnterRisePx: 10,
	flipMs: 280,
	liveFlipMs: 200,
	flipFadeShortenMs: 20,
	flipStaggerStepMs: 6,
	flipStaggerMaxMs: 90,
	flipMaxVerticalTravelRatio: 0.6,
	flipMinOffsetPx: 0.5,
	flipMinScaleChange: 0.005
});

export const QUEUE_MOTION = Object.freeze({
	glideMs: 220,
	travelMs: 240,
	travelMidpoint: 0.5,
	travelShadow: '0 14px 30px rgba(0, 0, 0, 0.45)',
	restingShadow: '0 0 0 rgba(0, 0, 0, 0)',
	exitMs: 160,
	exitTransform: 'translateX(-20px)',
	playedExitTransform: 'translateY(-16px)',
	enterMs: 220,
	enterSlidePx: 14,
	nowCrossfadeMs: 220,
	minRowOffsetPx: 0.5,
	overlayZIndex: 30
});

export const LAYOUT = Object.freeze({
	albumGrid: Object.freeze({ gapXPx: 22, gapYPx: 30, minTileWidthPx: 164, captionHeightPx: 50 }),
	artistRowHeightPx: 96,
	playlistTrackRowHeightPx: 50,
	virtualOverscanRows: 2,
	alphabetProbeOffsetPx: 4,
	alphabetJumpOffsetPx: 8,
	rerenderScrollMarginPx: 30,
	virtualReflowMinWidthChangePx: 0.1,
	resizeDebounceMs: 60
});

export const SHELVES = Object.freeze({
	jumpBackIn: Object.freeze({ minItemWidthPx: 236, gapPx: 12, rows: 2 }),
	homePlaylists: Object.freeze({ minItemWidthPx: 150, gapPx: 22, rows: 1 })
});

export const BENTO = Object.freeze({
	minHeightPx: 360,
	blockSpansByKindCount: Object.freeze({
		1: [[4, 3]],
		2: [[2, 3], [2, 3]],
		3: [[2, 3], [2, 2], [2, 1]]
	}),
	genreTileGapPx: 12,
	genreTileMaxSizePx: 150,
	rowMinWidthPx: 200,
	rowColumnGapPx: 12,
	rowHeightPx: 64,
	rowGapPx: 6
});

export const HOME = Object.freeze({
	artistStripCount: 14,
	playlistMixPattern: Object.freeze(['smart', 'genre', 'own', 'own', 'genre', 'smart', 'own', 'genre', 'own', 'own', 'genre', 'smart', 'own', 'genre'])
});

export const ALBUM_PAGE = Object.freeze({ moreByCount: 12 });

export const QUEUE = Object.freeze({
	visibleRowCap: 150,
	fullScreenUpNextCount: 6,
	countDisplayCap: 999
});

export const PLAYBACK = Object.freeze({
	audioStateHoldMs: 1500,
	restartInsteadOfPreviousAfterSeconds: 4,
	seekStepSeconds: 10,
	initialVolume: 0.72
});

export const PALETTE = Object.freeze({
	hoverPreviewRate: 3.4,
	revertRate: 2.2,
	trackChangeRate: 1.1,
	revertDelayMs: 160
});

export const ACCENT = Object.freeze({
	brightestChannel: 235,
	colourWeight: 0.6,
	whiteWeight: 0.4,
	whiteLevel: 0.95,
	snapDistance: 0.5
});

export const FIELD = Object.freeze({
	initialIntensity: 0.6,
	focusedIntensity: 1,
	browsingIntensity: 0.74,
	intensityFollowRate: 1.4,
	maxFrameSeconds: 0.1,
	reducedMotionFrameIntervalMs: 500,
	pointer: Object.freeze([0.5, 0.5])
});

export const LYRICS = Object.freeze({
	ambientSwapMs: 380,
	focusLineRatio: Object.freeze({ canvas: 0.4, classic: 0.36, panel: 0.32 })
});

export const IDLE = Object.freeze({
	defaultDelayMs: 4500,
	checkIntervalMs: 250
});

export const POPOVER = Object.freeze({
	edgeMarginPx: 12,
	anchorGapPx: 14,
	filterGapPx: 8,
	filterBottomReservePx: 100
});

export const TOAST = Object.freeze({ visibleMs: 1700 });

export const SEARCH = Object.freeze({
	recentCount: 7,
	artistLimit: 4,
	albumLimit: 6,
	playlistLimit: 3,
	trackLimit: 8
});

export const QUEUE_DRAG = Object.freeze({ startDistancePx: 4 });

export const LIBRARY_RULES = Object.freeze({
	genrePlaylistMinAlbums: 3,
	genrePlaylistMaxCount: 8,
	genrePlaylistTrackCap: 240
});

export const HISTORY = Object.freeze({ maxLength: 16 });

export const LIBRARY_SYNC = Object.freeze({
	pollIntervalMs: 60000,
	snapshotWriteDelayMs: 2000
});
