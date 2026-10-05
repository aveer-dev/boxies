// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Miller Columns E2E Test Harness & Shared Infrastructure
 * Provides DOM simulation, store isolation, Kumo token auditing,
 * and structured test collection / execution.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useColumnStack } from "../../app/hooks/useColumnStack.ts";

export const SPEC = {
	widths: {
		accounts: 300,
		folders: 300,
		threads: 400,
		reader: 848,
		readerMin: 700,
		settings: 540,
		compose: 560,
		search: 460,
		agent: 380,
	},
	coreFolders: [
		"inbox",
		"priority",
		"sent",
		"drafts",
		"scheduled",
		"archive",
		"trash",
	],
	systemFolderTitles: {
		inbox: "Inbox",
		priority: "Priority/VIP",
		sent: "Sent",
		drafts: "Drafts",
		scheduled: "Scheduled",
		archive: "Archive",
		trash: "Trash",
	},
	tagsSectionHeader: "HYPERION TAGS",
	shortcuts: {
		search: { key: "k", metaKey: true },
		compose: { key: "n", metaKey: true },
		settings: { key: ",", metaKey: true },
		popOut: { key: "o", metaKey: true, shiftKey: true },
		aiAssist: { key: "j", metaKey: true },
	},
	omnibar: {
		placeholder: "Search messages, senders, or commands...",
		badge: "⌘K",
		classes: ["bg-kumo-elevated", "backdrop-blur", "border-kumo-line", "text-kumo-default"],
	},
	kumoTokens: {
		allowedPrefixes: [
			"bg-kumo-",
			"text-kumo-",
			"border-kumo-",
			"ring-kumo-",
			"shadow-",
			"hover:bg-kumo-",
			"hover:text-kumo-",
			"focus:ring-kumo-",
			"focus-within:ring-kumo-",
		],
		forbiddenColorPatterns: [
			/\bbg-(red|blue|green|yellow|gray|zinc|slate|neutral|stone|amber|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-[0-9]+\b/,
			/\btext-(red|blue|green|yellow|gray|zinc|slate|neutral|stone|amber|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-[0-9]+\b/,
			/\bborder-(red|blue|green|yellow|gray|zinc|slate|neutral|stone|amber|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-[0-9]+\b/,
			/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/,
			/\brgb\s*\(/,
			/\brgba\s*\(/,
		],
	},
};

/**
 * Lightweight mock element for DOM tests
 */
export class MockDOMElement {
	constructor(id, tagName = "div") {
		this.id = id;
		this.tagName = tagName.toUpperCase();
		this.className = "";
		this.style = {};
		this.children = [];
		this.parentElement = null;
		this.scrollIntoViewCalls = [];
		this.scrollTop = 0;
		this.scrollLeft = 0;
		this.clientWidth = 1440;
		this.clientHeight = 900;
		this.scrollWidth = 1440;
		this.scrollHeight = 900;
		this._listeners = new Map();
		this.value = "";
		this.textContent = "";
		this.attributes = new Map();
	}

	setAttribute(name, val) {
		this.attributes.set(name, String(val));
	}

	getAttribute(name) {
		return this.attributes.get(name) || null;
	}

	hasAttribute(name) {
		return this.attributes.has(name);
	}

	scrollIntoView(options) {
		this.scrollIntoViewCalls.push(options);
	}

	addEventListener(event, listener) {
		if (!this._listeners.has(event)) {
			this._listeners.set(event, []);
		}
		this._listeners.get(event).push(listener);
	}

	removeEventListener(event, listener) {
		const list = this._listeners.get(event) || [];
		const idx = list.indexOf(listener);
		if (idx >= 0) list.splice(idx, 1);
	}

	dispatchEvent(event) {
		const list = this._listeners.get(event.type) || [];
		for (const fn of list) {
			fn(event);
		}
		return !event.defaultPrevented;
	}

	appendChild(child) {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	click() {
		this.dispatchEvent({ type: "click", target: this, stopPropagation: () => {} });
	}

	focus() {
		this.dispatchEvent({ type: "focus", target: this });
	}

	blur() {
		this.dispatchEvent({ type: "blur", target: this });
	}
}

let originalGlobals = null;
const mockElementsRegistry = new Map();

/**
 * Setup simulated DOM environment
 */
export function setupTestDOM() {
	if (originalGlobals) return;

	originalGlobals = {
		window: globalThis.window,
		document: globalThis.document,
		requestAnimationFrame: globalThis.requestAnimationFrame,
		KeyboardEvent: globalThis.KeyboardEvent,
		HTMLElement: globalThis.HTMLElement,
	};

	mockElementsRegistry.clear();
	const windowListeners = new Map();

	const mockDoc = {
		getElementById: (id) => {
			if (!mockElementsRegistry.has(id)) {
				mockElementsRegistry.set(id, new MockDOMElement(id));
			}
			return mockElementsRegistry.get(id);
		},
		createElement: (tagName) => new MockDOMElement("", tagName),
		body: new MockDOMElement("body", "BODY"),
		addEventListener: (event, fn) => {
			if (!windowListeners.has(event)) windowListeners.set(event, []);
			windowListeners.get(event).push(fn);
		},
		removeEventListener: (event, fn) => {
			const list = windowListeners.get(event) || [];
			const idx = list.indexOf(fn);
			if (idx >= 0) list.splice(idx, 1);
		},
	};

	const mockWin = {
		document: mockDoc,
		addEventListener: (event, fn) => {
			if (!windowListeners.has(event)) windowListeners.set(event, []);
			windowListeners.get(event).push(fn);
		},
		removeEventListener: (event, fn) => {
			const list = windowListeners.get(event) || [];
			const idx = list.indexOf(fn);
			if (idx >= 0) list.splice(idx, 1);
		},
		dispatchEvent: (event) => {
			const list = windowListeners.get(event.type) || [];
			for (const fn of list) {
				fn(event);
			}
			return !event.defaultPrevented;
		},
		requestAnimationFrame: (cb) => {
			return setTimeout(cb, 0);
		},
		cancelAnimationFrame: (id) => {
			clearTimeout(id);
		},
		innerWidth: 1440,
		innerHeight: 900,
	};

	globalThis.window = mockWin;
	globalThis.document = mockDoc;
	globalThis.requestAnimationFrame = mockWin.requestAnimationFrame;
	globalThis.cancelAnimationFrame = mockWin.cancelAnimationFrame;
	globalThis.HTMLElement = MockDOMElement;
}

/**
 * Restore original environment
 */
export function cleanupTestDOM() {
	if (!originalGlobals) return;
	// Keep document and rAF with safe no-op fallbacks so trailing timers in useColumnStack don't crash Node
	globalThis.document = {
		getElementById: () => null,
		createElement: () => new MockDOMElement("", "DIV"),
		addEventListener: () => {},
		removeEventListener: () => {},
	};
	globalThis.window = originalGlobals.window;
	globalThis.requestAnimationFrame = originalGlobals.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
	globalThis.cancelAnimationFrame = originalGlobals.cancelAnimationFrame || ((id) => clearTimeout(id));
	globalThis.KeyboardEvent = originalGlobals.KeyboardEvent;
	globalThis.HTMLElement = originalGlobals.HTMLElement;
	originalGlobals = null;
	mockElementsRegistry.clear();
}

/**
 * Dispatch keyboard shortcut to simulated window
 */
export function dispatchGlobalKey(key, { metaKey = false, ctrlKey = false, shiftKey = false, altKey = false } = {}) {
	let prevented = false;
	const event = {
		type: "keydown",
		key,
		metaKey,
		ctrlKey,
		shiftKey,
		altKey,
		preventDefault: () => {
			prevented = true;
		},
		get defaultPrevented() {
			return prevented;
		},
	};
	if (globalThis.window && globalThis.window.dispatchEvent) {
		globalThis.window.dispatchEvent(event);
	}
	return event;
}

/**
 * Retrieve simulated DOM element by ID
 */
export function getMockElement(id) {
	return mockElementsRegistry.get(id) || null;
}

/**
 * Reset useColumnStack store to fresh state
 */
export function resetColumnStack() {
	useColumnStack.setState({
		columns: [],
		activeColumnId: null,
		selectedMailboxId: null,
		selectedFolderId: "inbox",
		selectedEmailId: null,
	});
}

/**
 * Inspect a component source file for forbidden colors & tokens
 */
export function verifyKumoTokensInFile(relativeFilePath) {
	const fullPath = resolve(process.cwd(), relativeFilePath);
	if (!existsSync(fullPath)) {
		return { exists: false, violations: [] };
	}
	const content = readFileSync(fullPath, "utf8");
	const violations = [];

	for (const pattern of SPEC.kumoTokens.forbiddenColorPatterns) {
		const match = content.match(pattern);
		if (match) {
			violations.push(`Found forbidden color pattern "${match[0]}" in ${relativeFilePath}`);
		}
	}

	return { exists: true, violations };
}

/**
 * Read component file content safely
 */
export function readComponentSource(relativeFilePath) {
	const fullPath = resolve(process.cwd(), relativeFilePath);
	if (!existsSync(fullPath)) return null;
	return readFileSync(fullPath, "utf8");
}

/**
 * Centralized Test Runner Registry
 */
export class TestRegistry {
	constructor(name) {
		this.name = name;
		this.tests = [];
	}

	register(testDef) {
		const { id, title, tier, feature, run } = testDef;
		assert.ok(id, "Test must have an id");
		assert.ok(title, "Test must have a title");
		assert.ok(tier, "Test must have a tier");
		assert.ok(feature, "Test must have a feature");
		assert.ok(typeof run === "function", "Test must have a run function");
		this.tests.push(testDef);
	}

	async execute({ tierFilter = null, featureFilter = null, verbose = false } = {}) {
		setupTestDOM();
		const results = [];
		const startTime = Date.now();

		const filteredTests = this.tests.filter((t) => {
			if (tierFilter && t.tier !== tierFilter) return false;
			if (featureFilter && t.feature !== featureFilter) return false;
			return true;
		});

		for (const t of filteredTests) {
			resetColumnStack();
			const testStart = Date.now();
			let passed = false;
			let error = null;

			try {
				await t.run();
				passed = true;
			} catch (err) {
				passed = false;
				error = err;
			}

			const duration = Date.now() - testStart;
			results.push({
				id: t.id,
				title: t.title,
				tier: t.tier,
				feature: t.feature,
				passed,
				duration,
				error: error ? (error instanceof Error ? error.message : String(error)) : null,
				stack: error && error.stack ? error.stack : null,
			});

			if (verbose) {
				const statusIcon = passed ? "✔" : "✖";
				console.log(`  ${statusIcon} [${t.id}] [Tier ${t.tier}] [${t.feature}] ${t.title} (${duration}ms)`);
				if (!passed && error) {
					console.log(`      Error: ${error.message || error}`);
				}
			}
		}

		cleanupTestDOM();

		const totalDuration = Date.now() - startTime;
		const total = results.length;
		const passed = results.filter((r) => r.passed).length;
		const failed = results.filter((r) => !r.passed).length;

		return {
			name: this.name,
			total,
			passed,
			failed,
			duration: totalDuration,
			results,
		};
	}
}
