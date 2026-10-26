export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const bodyHasClass = (name: string) => document.body.classList.contains(name);

export const setBodyClass = (name: string, on: boolean) => document.body.classList.toggle(name, on);

export const setRootVariable = (name: string, value: string) => document.documentElement.style.setProperty(name, value);

export const mainScroller = () => document.getElementById('main');
