import lang from "./lang.js";
import { putLyricsInPlace, updateActiveLyrics } from "./lyrics.js";
import songdata from "./songdata.js";
import { secondsToTime, isElectron } from "./util.js";
import { updateSeekbarStatus, updateSeekbarTime } from "./seekbar.js";
import { Position, SongData } from "../../types.js";
import { getAppIcon } from "./appicon.js";

const documentRoot = document.querySelector(":root") as HTMLElement;

const featRegex = / \[?\{?\(?(?:feat\.?|ft\.?|featuring) .+\)?\]?\]?/i;
let artDataBlobUrl: string | undefined;
let hlsInstances: any[] = [];

export function updateNowPlaying() {
	// CHECK ID
	if(songdata.metadata.id)
		document.documentElement.classList.remove("not-playing");
	else
		document.documentElement.classList.add("not-playing");

	// WINDOW TITLE
	if (!document.documentElement.classList.contains("widget-mode")){
		if (songdata.metadata.id)
			document.title = lang.NOW_PLAYING_TITLE.replace("%TITLE%", songdata.metadata.title || lang.UNKNOWN_TITLE).replace("%ARTIST%", songdata.metadata.artist || lang.UNKNOWN_ARTIST) + " - " + window.title;
		else
			document.title = window.title;
	}

	// ARTIST, TITLE, ALBUM
	if(songdata.metadata.id){
		formatMetadata(document.getElementById("artist"), featRegex, "featuring", songdata.metadata.artist, lang.UNKNOWN_ARTIST);
		formatMetadata(document.getElementById("title"), featRegex, "featuring", songdata.metadata.title, lang.UNKNOWN_TITLE);
		formatMetadata(document.getElementById("album"), featRegex, "featuring", songdata.metadata.album, "");
	}else{
		document.getElementById("artist")!.textContent = lang.PLEASE_PLAY_SONG;
		document.getElementById("title")!.textContent = lang.NOT_PLAYING;
		document.getElementById("album")!.textContent = "";
	}

	// SCROBBLES
	const scrobbles = document.getElementById("scrobbles")!;
	if (songdata.lastfm?.userplaycount) {
		scrobbles.textContent = lang.SCROBBLE_COUNT.replace("%COUNT%", songdata.lastfm?.userplaycount);
		scrobbles.style.display = "";
	} else {
		scrobbles.textContent = "";
		scrobbles.style.display = "none";
	}

	// PLAYING INDICATOR
	if (songdata.app){
		const appicon = getAppIcon();
		documentRoot.style.setProperty("--app-icon", `url("${appicon.split("\"").join("\\\"")}")`);
	} else
		documentRoot.style.removeProperty("--app-icon");

	document.getElementById("player-playing")!.textContent = songdata.appName ? lang.PLAYING_ON_APP : "";
	document.getElementById("player-name")!.textContent = songdata.appName || "";

	// CONTROLS VISIBILITY
	const playPauseBtn = document.getElementById("playpause")!;
	const shuffleBtn = document.getElementById("shuffle")!;
	const repeatBtn = document.getElementById("repeat")!;

	setDisabledClass(playPauseBtn, songdata.capabilities.canPlayPause);
	setDisabledClass(document.getElementById("next"), songdata.capabilities.canGoNext);
	setDisabledClass(document.getElementById("previous"), songdata.capabilities.canGoPrevious);

	setDisabledClass(shuffleBtn, songdata.capabilities.canControl);
	setDisabledClass(repeatBtn, songdata.capabilities.canControl);

	setDisabledClass(document.getElementById("lastfm"), songdata.lastfm);
	setDisabledClass(document.getElementById("spotify"), songdata.spotify);

	// CONTROLS STATUS
	(playPauseBtn.firstElementChild! as HTMLElement).setAttribute("href", "assets/images/glyph.svg#" + (songdata.status === "Playing" ? "pause" : "play_arrow"));

	if (songdata.shuffle) shuffleBtn.classList.add("active");
	else shuffleBtn.classList.remove("active");

	switch (songdata.loop) {
		default:
			repeatBtn.classList.remove("active");
			(repeatBtn.firstElementChild! as HTMLElement).setAttribute("href", "assets/images/glyph.svg#repeat");
			break;
		case "Track":
			repeatBtn.classList.add("active");
			(repeatBtn.firstElementChild! as HTMLElement).setAttribute("href", "assets/images/glyph.svg#repeat_one");
			break;
		case "Playlist":
			repeatBtn.classList.add("active");
			(repeatBtn.firstElementChild! as HTMLElement).setAttribute("href", "assets/images/glyph.svg#repeat");
			break;
	}

	// SEEKBAR
	updateSeekbarStatus();

	// TIME
	updateTime();

	// ALBUM ART
	updateAlbumArt();

	// AND COLORS TOO
	updateColors();
}

async function updateAlbumArt(){
	const albumArtVideo = document.getElementById("album-art-video") as HTMLVideoElement;
	const backgroundVideo = document.getElementById("background-video") as HTMLVideoElement;

	let urlToApply = "";
	let isVideo = false;

	if (songdata.metadata.artUrl && isElectron()) {
		urlToApply = songdata.metadata.artUrl;
		isVideo = urlToApply.endsWith(".mp4") || urlToApply.endsWith(".webm") || urlToApply.endsWith(".m3u8");
	} else if (songdata.metadata.artData?.data) {
		const newArt = new Uint8Array(songdata.metadata.artData?.data);

		if(artDataBlobUrl){
			const oldArt = await fetch(artDataBlobUrl).then(async r => new Uint8Array(await r.arrayBuffer())) as Uint8Array;

			let same = true;
			if(oldArt.byteLength === newArt.byteLength){
				for (let i = 0; i < newArt.byteLength; i++) {
					if(oldArt[i] !== newArt[i]){
						same = false;
						break;
					}
				}
			}else
				same = false;

			if (same){
				urlToApply = artDataBlobUrl;
				// blob urls aren't explicitly checked for mp4 here natively yet, but we allow future proofing
				isVideo = (songdata.metadata.artData?.type?.[0] === "video/mp4");
			} else {
				(window.URL || window.webkitURL).revokeObjectURL(artDataBlobUrl);
				artDataBlobUrl = undefined;
			}
		}

		if (!urlToApply) {
			const newBlob = new Blob([newArt], { type: songdata.metadata.artData?.type?.[0] });
			artDataBlobUrl = (window.URL || window.webkitURL).createObjectURL(newBlob);
			urlToApply = artDataBlobUrl;
			isVideo = (songdata.metadata.artData?.type?.[0] === "video/mp4");
		}
	}

	if (urlToApply) {
		if (isVideo) {
			documentRoot.style.removeProperty("--cover-art-url");
			
			const triggerFallback = () => {
				console.warn("[Sunamu] Video playback failed or timed out. Falling back to static artwork.");
				documentRoot.style.setProperty("--cover-art-url", `url("${urlToApply.split("\"").join("\\\"")}")`);
				if (albumArtVideo) {
					albumArtVideo.style.display = "none";
					albumArtVideo.dataset.currentSrc = "";
				}
				if (backgroundVideo) {
					backgroundVideo.style.display = "none";
					backgroundVideo.dataset.currentSrc = "";
				}
				const albumArtElement = document.getElementById("album-art");
				if (albumArtElement) albumArtElement.style.visibility = "visible";
				document.documentElement.classList.remove("video-active");
			};

			const playVideo = (videoElem: HTMLVideoElement) => {
				if (videoElem.dataset.currentSrc === urlToApply) {
					if (videoElem.paused) videoElem.play().catch(() => {});
					return;
				}
				
				const isM3U8 = urlToApply.endsWith(".m3u8");
				videoElem.dataset.currentSrc = urlToApply;
				videoElem.crossOrigin = "anonymous";
				
				let loadTimeout = setTimeout(() => {
					if (videoElem.readyState < 2) triggerFallback();
				}, 2000);

				if (videoElem.src !== urlToApply && !isM3U8) {
					console.log("[Sunamu] Loading MP4 Video:", urlToApply);
					videoElem.src = urlToApply;
					videoElem.load();
					videoElem.onloadedmetadata = () => clearTimeout(loadTimeout);
					videoElem.play().catch(e => {
						console.warn("[Sunamu] Playback blocked:", e);
						triggerFallback();
					});
				} else if (isM3U8) {
					// @ts-ignore
					if (window.Hls && window.Hls.isSupported()) {
						console.log("[Sunamu] Hls.js is available and supported. Initializing...");
						console.log("[Sunamu] Loading HLS Stream:", urlToApply);
						hlsInstances.forEach(h => h.destroy());
						hlsInstances = [];
						
						// @ts-ignore
						const hls = new window.Hls();
						hls.loadSource(urlToApply);
						hls.attachMedia(videoElem);
						// @ts-ignore
						hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
							clearTimeout(loadTimeout);
							console.log("[Sunamu] Hls.js Manifest parsed successfully.");
							videoElem.play().catch(e => {
								console.warn("[Sunamu] HLS Playback blocked:", e);
								triggerFallback();
							});
						});
						// @ts-ignore
						hls.on(window.Hls.Events.ERROR, (event, data) => {
							if (data.fatal) {
								console.error("[Sunamu] HLS Fatal Error:", data.type, data.details);
								triggerFallback();
								hls.destroy();
							}
						});
					}
				}
			};

			if (albumArtVideo) {
				albumArtVideo.style.display = "block";
				playVideo(albumArtVideo);
				
				// Post-load size verification: detect GPU rendering failure
				setTimeout(() => {
					if (albumArtVideo.style.display === "block" && albumArtVideo.videoWidth === 0) {
						console.warn("[Sunamu] Video is active but has 0 size. Potential GPU hang detected.");
						triggerFallback();
					}
				}, 3000);
			}
			if (backgroundVideo) {
				backgroundVideo.style.display = "block";
				playVideo(backgroundVideo);
				setTimeout(() => { backgroundVideo.style.opacity = "1"; }, 100);
			}
			const albumArtElement = document.getElementById("album-art");
			if (albumArtElement) albumArtElement.style.visibility = "hidden";
			document.documentElement.classList.add("video-active");
		} else {
			documentRoot.style.setProperty("--cover-art-url", `url("${urlToApply.split("\"").join("\\\"")}")`);
			
			if (albumArtVideo) albumArtVideo.style.display = "none";
			if (backgroundVideo) {
				backgroundVideo.style.opacity = "0";
				setTimeout(() => { backgroundVideo.style.display = "none"; }, 2000);
			}
			const albumArtElement = document.getElementById("album-art");
			if (albumArtElement) albumArtElement.style.visibility = "visible";
			document.documentElement.classList.remove("video-active");
		}
	} else {
		documentRoot.style.removeProperty("--cover-art-url");
		if (albumArtVideo) {
			albumArtVideo.style.display = "none";
			albumArtVideo.dataset.currentSrc = "";
		}
		if (backgroundVideo) {
			backgroundVideo.style.opacity = "0";
			setTimeout(() => { 
				backgroundVideo.style.display = "none"; 
				backgroundVideo.dataset.currentSrc = "";
			}, 2000);
		}
		const albumArtElement = document.getElementById("album-art");
		if (albumArtElement) albumArtElement.style.visibility = "visible";
		document.documentElement.classList.remove("video-active");
	}
}

function updateColors(){
	const palette = songdata.metadata.artData?.palette;
	if(palette){
		document.documentElement.classList.remove("no-palette");
		documentRoot.style.setProperty("--color-vibrant", palette.Vibrant || null);
		documentRoot.style.setProperty("--color-muted", palette.Muted || null);
		documentRoot.style.setProperty("--color-light-vibrant", palette.LightVibrant || null);
		documentRoot.style.setProperty("--color-light-muted", palette.LightMuted || null);
		documentRoot.style.setProperty("--color-dark-vibrant", palette.DarkVibrant || null);
		documentRoot.style.setProperty("--color-dark-muted", palette.DarkMuted || null);
	}else{
		document.documentElement.classList.add("no-palette");
		documentRoot.style.removeProperty("--color-vibrant");
		documentRoot.style.removeProperty("--color-muted");
		documentRoot.style.removeProperty("--color-light-vibrant");
		documentRoot.style.removeProperty("--color-light-muted");
		documentRoot.style.removeProperty("--color-dark-vibrant");
		documentRoot.style.removeProperty("--color-dark-muted");
	}

	(document.getElementById("theme-color")! as HTMLMetaElement).content = window.getComputedStyle(documentRoot).getPropertyValue("--color-bg").trim();
}

function updateTime() {
	const timeElapsed = document.getElementById("time-elapsed")!;
	const timeTotal = document.getElementById("time-total")!;

	if(songdata.metadata.length)
		timeTotal.textContent = secondsToTime(songdata.metadata.length);
	else
		timeTotal.textContent = "00:00";

	if(songdata.elapsed.howMuch)
		timeElapsed.textContent = secondsToTime(songdata.elapsed.howMuch);
	else
		timeElapsed.textContent = "00:00";
}

function timePoll(){
	if(songdata.status !== "Playing")
		return;

	updateTime();
	updateSeekbarTime();
	updateActiveLyrics();
}

function setDisabledClass(elem, condition) {
	if (condition) elem.classList.remove("disabled");
	else elem.classList.add("disabled");
}

function formatMetadata(elem, regex, spanClass, data, fallback){
	if(!data)
		return elem.textContent = fallback;

	elem.textContent = "";
	const pieces = data.split(regex).filter(Boolean).map(x => ({ text: x, matches: !!x.match(regex) }));
	for(const piece of pieces){
		const span = document.createElement("span");
		if(piece.matches) span.classList.add(spanClass);
		span.textContent = piece.text;
		elem.appendChild(span);
	}
}

// --- REGISTER CALLBACKS
window.np.registerUpdateCallback((_songdata: SongData, metadataChanged: boolean) => {
	console.debug(_songdata, metadataChanged);
	for (const prop of Object.getOwnPropertyNames(songdata)) delete songdata[prop];
	Object.assign(songdata, _songdata);
	if (metadataChanged)
		putLyricsInPlace();

	updateNowPlaying();
	setInterval(timePoll, 50);
});

window.np.registerPositionCallback((position: Position, reportsPosition: boolean) => {
	songdata.elapsed = position;
	songdata.reportsPosition = reportsPosition;

	updateTime();
	updateSeekbarTime();
	updateActiveLyrics();
});
