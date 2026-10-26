export type GlassParams = {
	thick: number;
	bevel: number;
	curve: number;
	cut: number;
	body: number;
	lens: number;
	merge: number;
	ior: number;
	disp: number;
	frost: number;
	flip: number;
	light: number;
	elev: number;
	spec: number;
	refl: number;
	studio: number;
	rim: number;
	irid: number;
	tintA: number;
	shadow: number;
	caustic: number;
	tilt: number;
	settle: number;
	rimDir: number;
	shadowDist: number;
	shadowBlur: number;
	sat: number;
};

export type GlassKey = keyof GlassParams;

export const BASE: GlassParams = {
	thick: 40,
	bevel: 5,
	curve: 2,
	cut: 0,
	body: 0,
	lens: 0.9,
	merge: 30,
	ior: 1.9,
	disp: 0,
	frost: 0,
	flip: -1,
	light: -20,
	elev: 21,
	spec: 0.1,
	refl: 0.8,
	studio: 1,
	rim: 0.5,
	irid: 0,
	tintA: 0.06,
	shadow: 0.28,
	caustic: 0,
	tilt: 0.8,
	settle: 0.7,
	rimDir: 1,
	shadowDist: 16,
	shadowBlur: 30,
	sat: 1.1
};

export type GlassPreset = { id: string; name: string; values: GlassParams };

export const PRESETS: GlassPreset[] = [
	{ id: 'clear', name: 'Clear lens', values: BASE },
	{ id: 'frosted', name: 'Frosted', values: { ...BASE, frost: 6, tintA: 0.28, refl: 0.6 } },
	{ id: 'prism', name: 'Prism', values: { ...BASE, disp: 0.08, rim: 0.6 } },
	{ id: 'pebble', name: 'Pebble', values: { ...BASE, thick: 46, ior: 1.6, bevel: 44, curve: 2.2, body: 1, lens: 0.4, spec: 0.45, shadow: 0.38 } },
	{ id: 'bubble', name: 'Soap bubble', values: { ...BASE, thick: 22, ior: 1.33, disp: 0.12, bevel: 30, lens: 0.3, irid: 0.75, refl: 0.9, tintA: 0, rim: 0.4 } },
	{ id: 'slab', name: 'Cut slab', values: { ...BASE, thick: 30, ior: 1.7, bevel: 16, curve: 1, cut: 0.25, lens: 0, spec: 0.3 } },
	{
		id: 'css',
		name: 'CSS blur',
		values: { ...BASE, thick: 0, ior: 1, bevel: 2, lens: 0, merge: 0, frost: 26, flip: 1, light: 0, elev: 45, spec: 0, refl: 0, rim: 0.14, rimDir: 0, tintA: 0.7, shadow: 0.45, shadowDist: 18, shadowBlur: 50, sat: 1.3, tilt: 0 }
	}
];

export const DEFAULT_LOOK: GlassPreset = {
	id: 'default',
	name: 'Default',
	values: {
		...BASE,
		thick: 23,
		bevel: 11,
		curve: 4.2,
		cut: 0.05,
		body: 0.1,
		lens: 0.15,
		merge: 6,
		ior: 1.82,
		disp: 0.16,
		light: -23,
		elev: 26,
		spec: 0,
		refl: 0.85,
		studio: 0.6,
		rim: 0.3,
		tintA: 0.82
	}
};

export const LOOKS: GlassPreset[] = [DEFAULT_LOOK, ...PRESETS.filter((preset) => preset.id !== 'css')];

export type GlassSlider = { key: GlassKey; label: string; min: number; max: number; step: number; unit: string; note?: string };
export type GlassToggle = { key: GlassKey; label: string; toggle: true };
export type GlassControl = GlassSlider | GlassToggle;

const slider = (key: GlassKey, label: string, min: number, max: number, step: number, unit = '', note?: string): GlassSlider => ({ key, label, min, max, step, unit, note });

export const GROUPS: { title: string; controls: GlassControl[] }[] = [
	{
		title: 'Form',
		controls: [
			slider('thick', 'Thickness', 0, 90, 1, 'px'),
			slider('bevel', 'Bevel width', 2, 80, 1, 'px', 'how far the rounded rim reaches in from the outline'),
			slider('curve', 'Edge curvature', 1, 6, 0.1, '', '1 straight chamfer · 2 round · 4+ square shoulder'),
			slider('cut', 'Edge cut', -0.7, 0.9, 0.01, '', 'below 0 a raised wall at the outline · above 0 a shallow cap'),
			slider('body', 'Body', 0, 1, 0.01, '', '0 extruded like a glass rod · 1 an oval dome'),
			slider('lens', 'Dome', 0, 1.5, 0.05, '', 'extra curvature that magnifies')
		]
	},
	{
		title: 'Optics',
		controls: [
			slider('ior', 'Index of refraction', 1, 2.4, 0.01),
			slider('disp', 'Dispersion', 0, 0.35, 0.005, '', 'rainbow fringes at the rim'),
			slider('frost', 'Frost', 0, 40, 0.5, 'px'),
			{ key: 'flip', label: 'Rim pulls outside content in', toggle: true }
		]
	},
	{
		title: 'Light',
		controls: [
			slider('light', 'Light angle', -180, 180, 1, '°'),
			slider('elev', 'Light height', 10, 80, 1, '°'),
			slider('spec', 'Specular', 0, 2, 0.05),
			slider('refl', 'Fresnel reflection', 0, 1.5, 0.05),
			slider('studio', 'Reflected light', 0, 1, 0.01, '', '0 a dark room keeps glass clear · 1 bright surroundings'),
			slider('rim', 'Rim light', 0, 1.2, 0.02),
			slider('irid', 'Iridescence', 0, 1.2, 0.05)
		]
	},
	{
		title: 'Surface',
		controls: [slider('tintA', 'Tint', 0, 0.9, 0.01), slider('shadow', 'Shadow', 0, 1, 0.01), slider('caustic', 'Caustic', 0, 1, 0.01, '', 'light focused onto the page below')]
	}
];

const SLIDERS = new Map(
	GROUPS.flatMap((group) => group.controls)
		.filter((control): control is GlassSlider => !('toggle' in control))
		.map((control) => [control.key, { key: control.key, min: control.min, step: control.step }])
);
const LAB_ONLY: Partial<Record<GlassKey, { key: GlassKey; min: number; step: number }>> = {
	merge: { key: 'merge', min: 0, step: 1 },
	tilt: { key: 'tilt', min: 0, step: 0.05 },
	settle: { key: 'settle', min: 0.2, step: 0.05 },
	flip: { key: 'flip', min: -1, step: 2 }
};
const LAB_ORDER: GlassKey[] = ['thick', 'bevel', 'curve', 'cut', 'body', 'lens', 'merge', 'ior', 'disp', 'frost', 'light', 'elev', 'spec', 'refl', 'studio', 'rim', 'irid', 'tintA', 'shadow', 'caustic', 'tilt', 'settle', 'flip'];
const LAB_FIELDS = LAB_ORDER.map((key) => SLIDERS.get(key) ?? LAB_ONLY[key]!);
const LAB_LINK_VERSION = 1;
const LAB_SHAPE_GROUP = 3;

function bytesOf(text: string): Uint8Array {
	const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function decodeLabLink(link: string): { params: GlassParams; preset: string } {
	const hash = link.includes('#') ? link.slice(link.indexOf('#') + 1) : link.trim();
	if (!hash) return { params: { ...BASE }, preset: 'clear' };
	if (hash.includes('=')) {
		const query = new URLSearchParams(hash);
		const params = { ...BASE };
		for (const key of Object.keys(BASE) as GlassKey[]) {
			const value = Number(query.get(key));
			if (query.has(key) && Number.isFinite(value)) params[key] = value;
		}
		return { params, preset: 'clear' };
	}
	const bytes = bytesOf(hash);
	let offset = 0;
	const byte = () => {
		if (offset >= bytes.length) throw new Error('This lab link is cut short');
		return bytes[offset++];
	};
	const varint = () => {
		let value = 0;
		let scale = 1;
		for (;;) {
			const next = byte();
			value += (next & 127) * scale;
			if (next < 128) return value;
			scale *= 128;
		}
	};
	if (byte() !== LAB_LINK_VERSION) throw new Error('This lab link comes from a newer lab');
	const shape = byte() & 3;
	const base = PRESETS[byte()];
	if (!base) throw new Error('This lab link uses an unknown preset');
	const params = { ...base.values };
	if (shape === LAB_SHAPE_GROUP && params.thick > 0) params.body = Math.max(params.body, 0.4);
	let mask = varint();
	for (const field of LAB_FIELDS) {
		if (mask % 2) params[field.key] = +(field.min + varint() * field.step).toFixed(6);
		mask = Math.floor(mask / 2);
	}
	return { params, preset: base.id };
}

export function lightVector(params: GlassParams): [number, number, number, number, number] {
	const angle = (params.light * Math.PI) / 180;
	const elevation = (params.elev * Math.PI) / 180;
	const x = Math.sin(angle);
	const y = -Math.cos(angle);
	return [x * Math.cos(elevation), y * Math.cos(elevation), Math.sin(elevation), x, y];
}
