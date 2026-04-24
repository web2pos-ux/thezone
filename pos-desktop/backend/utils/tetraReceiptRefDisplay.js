/**
 * Helpers for Tetra semi-integrated values stored in payments.ref
 * (host reference + optional auth, tab-separated).
 */

'use strict';

function splitStoredTetraRef(raw) {
	if (raw == null || raw === '') return { host: '', auth: '' };
	const s = String(raw);
	const i = s.indexOf('\t');
	if (i < 0) return { host: s.trim(), auth: '' };
	return { host: s.slice(0, i).trim(), auth: s.slice(i + 1).trim() };
}

function truncateForReceipt(text, maxLen) {
	const t = String(text || '').trim();
	if (!t) return '';
	const n = Math.max(8, Number(maxLen) || 36);
	if (t.length <= n) return t;
	return `${t.slice(0, n - 3)}...`;
}

module.exports = {
	splitStoredTetraRef,
	truncateForReceipt,
};
