export type MenuItem = { label: string; run: () => void | Promise<void>; disabled?: boolean } | { separator: true };

export const menu = $state({ open: false, x: 0, y: 0, items: [] as MenuItem[] });

export function openMenu(event: MouseEvent, items: MenuItem[] | Promise<MenuItem[]>) {
	event.preventDefault();
	const { clientX, clientY } = event;
	void Promise.resolve(items).then((resolved) => {
		menu.items = resolved;
		menu.x = clientX;
		menu.y = clientY;
		menu.open = true;
	});
}

export function closeMenu() {
	menu.open = false;
}
