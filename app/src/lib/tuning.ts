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

export const ARTIST_PAGE = Object.freeze({
	similarCount: 12,
	topSongCount: 10,
	popularCount: 5
});

export const ARTIST_LIST = Object.freeze({ photos: true });

export const TIMELINE = Object.freeze({
	minAlbumsForLane: 3,
	coverPx: 64,
	gapPx: 10,
	padPx: 28,
	emptyYearPx: 22,
	laneHeightPx: 86,
	labelWidthPx: 200,
	headerHeightPx: 64,
	tailPx: 240,
	dragThresholdPx: 5,
	markRoomPx: 72
});

export const COVER_PX = Object.freeze({
	fallback: 300,
	row: 80,
	card: 120,
	panel: 160,
	tile: 400,
	tileQuarter: 200,
	mosaicMini: 60,
	ambient: 600,
	albumPage: 700,
	nowCanvas: 800,
	nowClassic: 900,
	mediaSession: 512,
	playlistPage: 440,
	artistPlaylist: 260,
	glassWall: 240
});

export const GENRE_COVER = Object.freeze({
	wallTiles: 16,
	wallRowLength: 4,
	tileToCoverRatio: 0.8,
	miniTilePx: 60,
	maxNamePx: 78,
	nameWidthPx: 520,
	letterWidthRatio: 0.74,
	offMidLightnessPenalty: 1.6,
	minSaturation: 0.45,
	maxSaturation: 0.9,
	maxDeepSaturation: 0.5,
	accentLightness: 0.68,
	deepLightness: 0.08,
	deepAlpha: 0.7
});

export const SCROLL_RESTORE = Object.freeze({
	settleMs: 400,
	giveUpMs: 2500,
	reachedPx: 2
});

export const GLASS_TUNER = Object.freeze({ wallCovers: 24 });

export const QUEUE = Object.freeze({
	visibleRowCap: 150,
	fullScreenUpNextCount: 6,
	countDisplayCap: 999
});

export const RADIO = Object.freeze({ nowPlayingPollMs: 10_000, firstTitlePollMs: 2_000 });

export const PLAYBACK = Object.freeze({
	restartInsteadOfPreviousAfterSeconds: 4,
	seekStepSeconds: 10,
	initialVolume: 0.72,
	tickMs: 100,
	startToleranceSeconds: 1,
	contextResumeTimeoutMs: 1500
});

export const PALETTE = Object.freeze({
	hoverPreviewRate: 3.4,
	revertRate: 2.2,
	trackChangeRate: 1.1,
	revertDelayMs: 160,
	coverColors: 5,
	coverSamplePx: 64
});

export const ACCENT = Object.freeze({
	brightestChannel: 235,
	colourWeight: 0.6,
	whiteWeight: 0.4,
	whiteLevel: 0.95,
	snapDistance: 0.5,
	vividSaturation: 0.82,
	vividLightness: 0.6,
	vividMinSaturation: 0.12
});

export const FIELD = Object.freeze({
	initialIntensity: 0.6,
	focusedIntensity: 1,
	browsingIntensity: 0.74,
	intensityFollowRate: 1.4,
	maxFrameSeconds: 0.1,
	reducedMotionFrameIntervalMs: 500,
	snapshotWidthPx: 192,
	snapshotIntervalMs: 100,
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

export const CONNECTION = Object.freeze({ retryMs: 10000, skipFailedTracksInRow: 3 });

export const SEARCH = Object.freeze({
	recentCount: 7,
	artistLimit: 4,
	albumLimit: 6,
	playlistLimit: 3,
	trackLimit: 8
});

export const QUEUE_DRAG = Object.freeze({ startDistancePx: 4 });

export const GENRE_EVIDENCE = Object.freeze({
	fileTagWeight: 1,
	minTagShare: 0.4,
	confidentVotes: 3,
	storeGenreWeight: 0.5,
	minWeight: 1
});

export const HIDDEN_GENRE_PLAYLISTS: readonly string[] = Object.freeze(['Nu Metal']);

export const GENRE_PLAYLISTS = Object.freeze({
	rootMinSongs: 30,
	rootMinArtists: 2,
	subMinSongs: 50,
	subMinArtists: 3,
	maxParentShare: 0.7,
	maxSiblingShare: 0.8,
	maxPickedShare: 0.5,
	maxPlaylists: 24,
	songCap: 100,
	minSongSeconds: 75,
	fanPower: 0.2,
	artistShareCap: 0.15,
	artistPlaysDivisor: 1000,
	artistGap: 3,
	playsDivisor: 100,
	likeMultiplier: 1.25,
	unknownPopularityShare: 0.5,
	weeklyNoise: 0.4
});

export const HISTORY = Object.freeze({ maxLength: 16 });

export const SCROBBLE = Object.freeze({
	minTrackSeconds: 30,
	afterSeconds: 240,
	maxTickSeconds: 1
});

export const SAVED_QUEUE = Object.freeze({
	saveDelayMs: 3000,
	whilePlayingMs: 30000
});

export const REMOTE = Object.freeze({
	reconnectMinMs: 1000,
	reconnectMaxMs: 30000,
	keepAliveMs: 25000,
	playbackResyncMs: 10000,
	positionJumpSeconds: 1.5,
	queuePublishDelayMs: 50
});

export const ENRICHMENT = Object.freeze({
	applyDelayMs: 1000,
	applyIntervalMs: 30000,
	requestIntervalMs: 6 * 60 * 60 * 1000
});

export const LIBRARY_SYNC = Object.freeze({
	pollIntervalMs: 60000,
	pageSize: 5000,
	snapshotWriteDelayMs: 2000,
	fullSyncIntervalMs: 24 * 60 * 60 * 1000,
	changePageSize: 2,
	albumsPerSongRequest: 40,
	fullSyncChangedAlbumShare: 0.3,
	fullSyncChangedAlbumMin: 50
});
