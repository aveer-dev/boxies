// The text-size slider's range, as a percentage of the design's type sizes.
// Base.astro restores the saved size before first paint; TypeSlider.astro
// moves it. Both read these, so they agree on the range and the storage key.
export const TYPE_SCALE = {
	min: 80,
	max: 200,
	default: 100,
	storageKey: "type-scale",
} as const;
