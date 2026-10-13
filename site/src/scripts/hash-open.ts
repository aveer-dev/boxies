// A link to an answer (/support#forgot-password) opens its toggle, brings it
// into view and flashes its summary once. scroll-padding keeps it clear of
// the fixed header.
function openHash() {
	let id = location.hash.slice(1);
	try {
		id = decodeURIComponent(id);
	} catch {} // a mangled link (#%E0%A4%A): look it up as it is
	if (!id) return;
	const target = document.getElementById(id);
	const details = target?.closest("details");
	if (!target || !details) return;
	details.open = true;
	target.scrollIntoView({ block: "start" });
	details.classList.remove("is-flash");
	void details.offsetWidth; // restart the flash if it is still running
	details.classList.add("is-flash");
	setTimeout(() => details.classList.remove("is-flash"), 900);
}

openHash();
addEventListener("hashchange", openHash);
