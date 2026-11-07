// CSS easing curves shared by the animation code.
export const EASING = Object.freeze({
	standard: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
	easeOutCubic: 'cubic-bezier(0.215, 0.61, 0.355, 1)'
});

// The collapsible navigation rail on the left (size and open/close animation).
export const RAIL = Object.freeze({
	collapsedWidthPx: 64,
	expandedWidthPx: 196,
	leftInsetPx: 12,
	labelRevealStartProgress: 0.6,
	gestureZoneMarginPx: 24,
	animationMs: 240,
	animationMinMs: 120
});

// The right-hand side panel (queue, lyrics) and its slide animation.
export const PANEL = Object.freeze({
	slideDistancePx: 384,
	contentInsetPx: 376,
	snapMs: 240,
	snapMinMs: 120,
	transitionCleanupMarginMs: 40,
	tabInkBaseWidthPx: 10
});

// Trackpad/wheel swipe recognition: deciding the axis and when a gesture has ended.
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

// Swipe-to-act on list rows. *Progress values are fractions of the row width.
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

// View entry and FLIP layout animations.
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

// Queue row animations (reorder, remove, advance).
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

// Breakpoints, touch thresholds and virtualised grid/list sizes.
export const LAYOUT = Object.freeze({
	phoneMediaQuery: '(max-width: 640px)',
	longPressMs: 450,
	longPressMovePx: 10,
	swipeSlopPx: 8,
	swipeDismissPx: 110,
	swipeDismissPxPerMs: 0.6,
	albumGrid: Object.freeze({ gapXPx: 22, gapYPx: 30, minTileWidthPx: 164, captionHeightPx: 50 }),
	albumGridPhone: Object.freeze({ gapXPx: 12, gapYPx: 18, minTileWidthPx: 140, captionHeightPx: 46 }),
	artistRowHeightPx: 96,
	playlistTrackRowHeightPx: 50,
	virtualOverscanRows: 2,
	alphabetProbeOffsetPx: 4,
	alphabetJumpOffsetPx: 8,
	rerenderScrollMarginPx: 30,
	virtualReflowMinWidthChangePx: 0.1,
	resizeDebounceMs: 60
});

// Home page shelves (jump back in, playlists) on desktop and phone.
export const SHELVES = Object.freeze({
	jumpBackIn: Object.freeze({ minItemWidthPx: 236, gapPx: 12, rows: 2, phone: Object.freeze({ columns: 2, rows: 3, gapPx: 8 }) }),
	homePlaylists: Object.freeze({ minItemWidthPx: 150, gapPx: 22, rows: 1, phone: Object.freeze({ columns: 3, rows: 2, gapPx: 12 }) })
});

// The bento grid of genre tiles and lists.
export const BENTO = Object.freeze({
	minHeightPx: 360,
	genreTileGapPx: 12,
	phoneListRows: 5,
	phoneGenreColumns: 3,
	phoneGenreRows: 2,
	genreTileMinPx: 104,
	soloTileMinPx: 180,
	soloTileGapPx: 22,
	genreMaxColumns: 5,
	genreMaxRows: 2,
	listMaxColumns: 2,
	soloListMaxColumns: 3,
	listMaxRows: 6,
	alignWithinPx: 72,
	growMaxRatio: 1.25,
	rowMinWidthPx: 200,
	rowColumnGapPx: 12,
	rowHeightPx: 64,
	rowGapPx: 6
});

// Home page content. playlistMixPattern is the repeating order of playlist kinds in the mix.
export const HOME = Object.freeze({
	artistStripCount: 14,
	phoneArtistRows: 2,
	playlistMixPattern: Object.freeze([
		'smart',
		'genre',
		'own',
		'own',
		'genre',
		'smart',
		'own',
		'genre',
		'own',
		'own',
		'genre',
		'smart',
		'own',
		'genre'
	])
});

// Album page.
export const ALBUM_PAGE = Object.freeze({ moreByCount: 12 });

// Artist page: how many similar artists and top songs to ask Navidrome for and show.
export const ARTIST_PAGE = Object.freeze({
	similarCount: 12,
	topSongCount: 10,
	popularCount: 5
});

// Artist tiles and rows.
export const ARTIST_LIST = Object.freeze({ photos: true });

// The release-year timeline view.
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

// The only cover sizes (px) ever requested, so the browser cache is shared between components of
// similar size. Requests round up to the next tier.
export const COVER_TIERS = Object.freeze([120, 300, 600, 1200] as const);

const [SMALL, MEDIUM, LARGE, FULL] = COVER_TIERS;

// Which cover tier each place in the UI uses.
export const COVER_PX = Object.freeze({
	fallback: MEDIUM,
	row: SMALL,
	card: SMALL,
	panel: MEDIUM,
	tile: LARGE,
	tileQuarter: MEDIUM,
	mosaicMini: SMALL,
	ambient: LARGE,
	albumPage: FULL,
	nowPhone: FULL,
	nowClassic: FULL,
	mediaSession: LARGE,
	playlistPage: LARGE,
	artistPlaylist: MEDIUM,
	glassWall: MEDIUM,
	paletteSample: SMALL
});

// Generated covers for genre playlists (cover wall, name and colours).
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

// Restoring scroll position on back/forward while content is still loading.
export const SCROLL_RESTORE = Object.freeze({
	settleMs: 400,
	giveUpMs: 2500,
	reachedPx: 2
});

// The /glass playground page.
export const GLASS_TUNER = Object.freeze({ wallCovers: 24 });

// Queue display limits.
export const QUEUE = Object.freeze({
	visibleRowCap: 150,
	fullScreenUpNextCount: 6,
	countDisplayCap: 999
});

// Internet radio "now playing" polling.
export const RADIO = Object.freeze({ nowPlayingPollMs: 10_000, firstTitlePollMs: 2_000 });

// Player behaviour and timing.
export const PLAYBACK = Object.freeze({
	restartInsteadOfPreviousAfterSeconds: 4,
	seekStepSeconds: 10,
	initialVolume: 0.72,
	tickMs: 100,
	startToleranceSeconds: 1,
	contextResumeTimeoutMs: 1500,
	// iPhone only: a pause longer than this reloads the track on resume (see AudioEngine.resume).
	reloadAfterPauseMs: 20_000
});

// Album colour palettes and how fast the background follows them. *Rate values are exponential
// smoothing speeds per second (higher = faster transition).
export const PALETTE = Object.freeze({
	hoverPreviewRate: 3.4,
	revertRate: 2.2,
	trackChangeRate: 1.1,
	revertDelayMs: 160,
	coverColors: 5,
	coverSamplePx: 96
});

// Deriving the UI accent colour from the album palette. vivid* values are HSL, 0..1.
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

// The animated background field.
export const FIELD = Object.freeze({
	initialIntensity: 0.6,
	focusedIntensity: 1,
	browsingIntensity: 0.74,
	// Exponential smoothing speed per second.
	intensityFollowRate: 1.4,
	// Caps the time step after a stalled or hidden frame so colours don't jump.
	maxFrameSeconds: 0.1,
	reducedMotionFrameIntervalMs: 500,
	snapshotWidthPx: 192,
	snapshotIntervalMs: 100,
	pointer: Object.freeze([0.5, 0.5])
});

// Lyrics display.
export const LYRICS = Object.freeze({
	ambientSwapMs: 380,
	focusLineRatio: Object.freeze({ classic: 0.36, panel: 0.32 })
});

// Idle mode: fading the UI out after a while without input during playback.
export const IDLE = Object.freeze({
	defaultDelayMs: 4500,
	checkIntervalMs: 250
});

// Popover and context menu placement.
export const POPOVER = Object.freeze({
	edgeMarginPx: 12,
	anchorGapPx: 14,
	filterGapPx: 8,
	filterBottomReservePx: 100
});

// Toast notifications.
export const TOAST = Object.freeze({ visibleMs: 1700 });

// Behaviour while Navidrome is unreachable.
export const CONNECTION = Object.freeze({ retryMs: 10000, skipFailedTracksInRow: 3 });

// Search palette: result counts per section.
export const SEARCH = Object.freeze({
	recentCount: 7,
	artistLimit: 4,
	albumLimit: 6,
	playlistLimit: 3,
	trackLimit: 8
});

// Dragging queue rows.
export const QUEUE_DRAG = Object.freeze({ startDistancePx: 4 });

// Weights for choosing a track's genres from file tags, MusicBrainz tags and store genres.
// Part of derivedRules() in library/build.ts: changing it rebuilds genres in saved libraries.
export const GENRE_EVIDENCE = Object.freeze({
	fileTagWeight: 1,
	minTagShare: 0.4,
	confidentVotes: 3,
	storeGenreWeight: 0.5,
	minWeight: 1
});

// Genres never turned into genre playlists. Hosts add their own with VIBEMUSIC_GENRE_HIDDEN
// (config.json, see serverConfig.ts).
export const HIDDEN_GENRE_PLAYLISTS: readonly string[] = Object.freeze([]);

// Which genres get a generated playlist and how its songs are picked and ordered. Some can be
// overridden per instance in config.json (serverConfig.ts). Part of derivedRules() in
// library/build.ts: changing them rebuilds genre playlists in saved libraries.
export const GENRE_PLAYLISTS = Object.freeze({
	rootMinSongs: 30,
	rootMinArtists: 2,
	subMinSongs: 50,
	subMinArtists: 3,
	maxParentShare: 0.7,
	maxSiblingShare: 0.8,
	maxPickedShare: 0.5,
	maxPlaylists: 24,
	// Most songs per genre playlist.
	songCap: 100,
	minSongSeconds: 75,
	fanPower: 0.2,
	artistShareCap: 0.15,
	artistPlaysDivisor: 1000,
	artistGap: 3,
	playsDivisor: 100,
	likeMultiplier: 1.25,
	unknownPopularityShare: 0.5,
	// Random score jitter seeded by song and week, so playlists rotate weekly but stay stable within a week.
	weeklyNoise: 0.4
});

// "Jump back in" history length.
export const HISTORY = Object.freeze({ maxLength: 16 });

// When a play counts as a scrobble.
export const SCROBBLE = Object.freeze({
	// Shorter tracks are never scrobbled.
	minTrackSeconds: 30,
	// Scrobble after half the track or this many seconds, whichever comes first.
	afterSeconds: 240,
	// Most listening time credited per player tick, so seeks and stalls don't count as listening.
	maxTickSeconds: 1
});

// Saving the play queue to Navidrome.
export const SAVED_QUEUE = Object.freeze({
	saveDelayMs: 3000,
	// While playing, the queue (with position) is saved at most this often.
	whilePlayingMs: 30000
});

// Remote control between devices through the relay WebSocket.
export const REMOTE = Object.freeze({
	reconnectMinMs: 1000,
	reconnectMaxMs: 30000,
	deviceProbeMs: 150,
	keepAliveMs: 25000,
	playbackResyncMs: 10000,
	positionJumpSeconds: 1.5,
	queuePublishDelayMs: 50
});

// Genre and popularity data from the relay.
export const ENRICHMENT = Object.freeze({
	// Wait after the first piece arrives, to batch the pieces that follow.
	applyDelayMs: 1000,
	// Minimum time between applies; each one rebuilds derived tables and saves.
	applyIntervalMs: 30000,
	// How often the leader asks the relay again for new data.
	requestIntervalMs: 6 * 60 * 60 * 1000
});

// Library sync from Navidrome (leader tab only).
export const LIBRARY_SYNC = Object.freeze({
	// Poll interval while the event stream is down.
	pollIntervalMs: 60000,
	// Items per request when paging through the native API.
	pageSize: 5000,
	// Debounce for saving after local edits (stars, plays, palettes).
	snapshotWriteDelayMs: 2000,
	// A full sync at least this often, as a safety net for anything the incremental sync misses.
	fullSyncIntervalMs: 24 * 60 * 60 * 1000,
	// First page size when reading changes; it grows 4x per page.
	changePageSize: 2,
	// Ids per request when fetching songs, albums or artists by id.
	albumsPerSongRequest: 40,
	// More changed albums than max(min, share of the local library): do a full sync instead.
	fullSyncChangedAlbumShare: 0.3,
	fullSyncChangedAlbumMin: 50,
	// Poll interval while the event stream is live.
	livePollIntervalMs: 5 * 60 * 1000,
	// Wait for a burst of events to settle before syncing.
	eventDebounceMs: 1500,
	eventRetryMinMs: 2000,
	eventRetryMaxMs: 60 * 1000,
	// Navidrome sends keepAlive about every 15 s; this much silence means the stream is dead.
	eventSilenceMs: 45 * 1000
});

// The localStorage leader lease used when Web Locks are unavailable (library/lease.ts).
export const LEADER_LEASE = Object.freeze({
	// A lease not renewed for this long can be taken over (its tab probably closed or crashed).
	ttlMs: 90 * 1000,
	renewMs: 20 * 1000,
	// Wait after claiming before re-reading, in case another tab claimed at the same time.
	settleMs: 300
});

// Saving the library database to IndexedDB.
export const LIBRARY_STORE = Object.freeze({
	// Smaller chunks mean less rewritten per save but more IndexedDB records.
	chunkBytes: 1024 * 1024
});

// Retrying covers that Navidrome throttled with 429 (it limits concurrent cover requests).
export const COVER_RETRY = Object.freeze({
	attempts: 4,
	baseDelayMs: 600,
	jitterMs: 900
});
