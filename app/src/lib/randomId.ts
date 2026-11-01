// crypto.randomUUID only exists in secure contexts (https or localhost), and the app also has to
// work when served over plain http. getRandomValues is available everywhere.
export const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
