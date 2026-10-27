const ISLAND_LEFT_ANGLE = 90;
const ISLAND_RIGHT_ANGLES = [270, -90];

function islandSide(): 'left' | 'right' | null {
	if (!matchMedia('(pointer: coarse)').matches) return null;
	const angle = screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0;
	if (angle === ISLAND_LEFT_ANGLE) return 'left';
	if (ISLAND_RIGHT_ANGLES.includes(angle)) return 'right';
	return null;
}

export function installScreenEdges(): () => void {
	const update = () => {
		const side = islandSide();
		document.body.classList.toggle('island-left', side === 'left');
		document.body.classList.toggle('island-right', side === 'right');
	};
	update();
	screen.orientation?.addEventListener('change', update);
	addEventListener('orientationchange', update);
	addEventListener('resize', update);
	return () => {
		screen.orientation?.removeEventListener('change', update);
		removeEventListener('orientationchange', update);
		removeEventListener('resize', update);
	};
}
