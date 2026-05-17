/**
 * Official Prusa Link favicon SVG path data embedded inline.
 * Source: github.com/prusa3d/Prusa-Link-Web/src/assets/prusa-link-favicon.svg
 *
 * Returns an SVG <g> element positioned as a small badge at the bottom-right
 * corner of a 72×72 Stream Deck key.
 */
export function prusaBadgeSvg(size = 16): string {
	// Original viewBox: 42.47×42.47 → scale to `size`
	const scale = size / 42.47;
	const x = 72 - size - 3;
	const y = 72 - size - 3;

	return `<g transform="translate(${x},${y}) scale(${scale.toFixed(4)})">
	<rect width="42.47" height="42.47" rx="4" fill="#FA6831"/>
	<path fill="#fefefe" fill-rule="nonzero" d="M12.23 34.79h19.71v-6.07H19.29V7.68h-7.06z"/>
</g>`;
}
