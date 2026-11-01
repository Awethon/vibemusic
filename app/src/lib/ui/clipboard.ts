// Copying text on https and on plain http. navigator.clipboard only exists in secure contexts; on
// plain http the older execCommand('copy') still works while the click that started it counts as
// recent. Callers fall back to showing the text when both fail.

export async function copyText(text: string): Promise<boolean> {
	if (navigator.clipboard) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Denied (permissions, or the page lost focus); try the older way.
		}
	}
	return copyWithSelection(text);
}

export function copyWithSelection(text: string): boolean {
	const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const field = document.createElement('textarea');
	field.value = text;
	field.readOnly = true;
	// Off screen but still selectable; display: none would make the selection empty.
	field.style.cssText = 'position: fixed; top: 0; left: -9999px; opacity: 0';
	document.body.append(field);
	field.select();
	let copied = false;
	try {
		copied = document.execCommand('copy');
	} catch {
		copied = false;
	}
	field.remove();
	previous?.focus({ preventScroll: true });
	return copied;
}
