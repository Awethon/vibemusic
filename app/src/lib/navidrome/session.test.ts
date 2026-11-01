import { describe, expect, it } from 'vitest';
import { firstRunFromPage } from './session.ts';

const page = (config: object) => `<script>window.__APP_CONFIG__ = ${JSON.stringify(JSON.stringify(config))}</script>`;

describe('firstRunFromPage', () => {
	it('reads the first-run flag from Navidrome’s web UI page', () => {
		expect(firstRunFromPage(page({ baseURL: '', defaultTheme: 'Dark', firstTime: true }))).toBe(true);
		expect(firstRunFromPage(page({ baseURL: '', firstTime: false }))).toBe(false);
	});

	it('says no for any other page', () => {
		expect(firstRunFromPage('<!doctype html><title>vibemusic</title>')).toBe(false);
		expect(firstRunFromPage('window.__APP_CONFIG__ = "{not json"')).toBe(false);
	});
});
