/// <reference types="astro/client" />

interface Window {
	// Set by the boot script in Base.astro: points art-directed <source data-theme-media> at a theme.
	__themeMedia?: (theme: "dark" | "light" | null, root?: ParentNode) => void;
}
