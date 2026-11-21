// Links to /request (AVE-233): rendered with `hidden` and shown only once
// GET /api/requests says the form can send, so no page points at an offline
// form. The /request page itself still renders and explains when it's offline.
const links = document.querySelectorAll<HTMLElement>("[data-request-link]");
if (links.length) {
	fetch("/api/requests", { headers: { accept: "application/json" } })
		.then((res) => (res.ok ? (res.json() as Promise<{ available?: boolean }>) : null))
		.then((info) => {
			if (info?.available) links.forEach((link) => (link.hidden = false));
		})
		.catch(() => {});
}
