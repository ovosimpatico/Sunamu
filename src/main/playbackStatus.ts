import { DeepPartial, Lyrics, Metadata, SongData, SpotifyInfo, Update } from "../types";
import { get } from "./config";
import getPlayer from "./player";
import { getSpotifySongFromId, searchSpotifySong } from "./thirdparty/spotify";
import { getLFMTrackInfo } from "./thirdparty/lastfm";
import { spotiId } from "./util";
import { queryLyricsAutomatically, saveCustomLyrics } from "./integrations/lyrics";
import { debug } from ".";
import { lyricsActive } from "./appStatus";
import EventEmitter from "events";
import { eventDispatcher, onLyricsSync, onPositionUpdate, onPlaybackState } from "./eventDispatcher";
import { positionManager } from "./positionManager";

const emitter = new EventEmitter();
export{ emitter as default };

// Set up event dispatcher listeners to bridge to the existing event system
onLyricsSync((event) => {
	// Emit precise lyrics sync events
	emitter.emit("lyrics.sync", event);
});

onPositionUpdate((event) => {
	// Only emit high-precision position updates to avoid flooding
	if (event.accuracy === "high") {
		emitter.emit("position.precise", event.position, event.isPlaying);
	}
});

onPlaybackState((event) => {
	// Emit playback state changes
	emitter.emit("playback.state", event);
});

// Initialize position manager with player's GetPosition function
async function initializePositionManager() {
	const player = await getPlayer();
	positionManager.initialize(() => player.GetPosition());
}

initializePositionManager();

const fallback: DeepPartial<SongData> = {
	provider: undefined,
	metadata: {
		title: undefined,
		artist: undefined,
		artists: undefined,
		albumArtist: undefined,
		albumArtists: undefined,
		album: undefined,
		artUrl: undefined,
		artData: undefined,
		length: undefined,
		id: undefined
	},
	capabilities: {
		canControl: false,
		canPlayPause: false,
		canGoNext: false,
		canGoPrevious: false,
		canSeek: false
	},
	status: "Stopped",
	loop: "None",
	shuffle: false,
	volume: 0,
	elapsed: {
		howMuch: 0,
		when: new Date(0)
	},
	reportsPosition: false,
	app: undefined,
	appName: undefined,
	lyrics: { unavailable: true },
	lastfm: undefined,
	spotify: undefined
};

export const songdata = Object.assign({}, fallback) as SongData;

let updateInfoSymbol: Symbol;

export async function setCustomLyrics(lyrics: Lyrics) {
	songdata.lyrics = lyrics;

	await saveCustomLyrics(songdata.metadata, lyrics);

	emitter.emit("songdata", songdata, false);
	emitter.emit("lyrics");
}

export async function updateInfo(update?: Update) {
	// create our unique symbol
	const currentSymbol = Symbol();

	// did the metadata change?
	const metadataChanged = hasMetadataChanged(songdata.metadata, update?.metadata);

	// incrementally update the current status
	Object.assign(songdata, update || fallback);

	if (metadataChanged) {
		// we set our symbol as the global one since we're tasked with extra stuff
		updateInfoSymbol = currentSymbol;

		// we need to reset our extra songdata stuff
		songdata.lyrics = update?.metadata.id && lyricsActive
			? undefined
			: { unavailable: true };

		songdata.lastfm = undefined;
		songdata.spotify = undefined;

		// Update position manager and event dispatcher with track info
		if (update?.metadata.length) {
			eventDispatcher.setTrackInfo(update.metadata.length, []);
		}

		// broadcast our initial update so people won't think sunamu is laggy asf
		emitter.emit("songdata", songdata, true);
		// this also updates the lyrics to whatever screen is suitable

		// if we do have an update containing an ID in it, then we assume a track is playing
		// and therefore we can get extra information about it
		if (!update?.metadata.id) return;

		// we pre-emptively check our symbol to avoid consuming API calls for nothing
		// because there's already newer stuff than us
		if(currentSymbol !== updateInfoSymbol) return;

		// BEGIN OF "HUGE SUSPENSION POINT"
		const extraMetadata: Partial<SongData> = {};
		extraMetadata.spotify = await pollSpotifyDetails(update.metadata);
		extraMetadata.lastfm = await getLFMTrackInfo(update.metadata, get("lfmUsername"));
		if(lyricsActive)
			extraMetadata.lyrics = await queryLyricsAutomatically(update.metadata);
		// END OF "HUGE SUSPENSION POINT"

		// we now have to check our symbol to avoid updating stuff that is newer than us
		// also, is there a way to de-dupe this?
		if(currentSymbol !== updateInfoSymbol) return;

		// now we assign the extra metadata on songdata
		Object.assign(songdata, extraMetadata);

		// Update event dispatcher with lyrics if available
		if (extraMetadata.lyrics && songdata.metadata.length) {
			const lyricsLines = parseLyricsForEventDispatcher(extraMetadata.lyrics);
			eventDispatcher.setTrackInfo(songdata.metadata.length, lyricsLines);
		}

	}

	// adjust reportsPosition prop from update
	songdata.reportsPosition = songdata.elapsed.howMuch > 0;

	// we broadcast the changed status
	emitter.emit("songdata", songdata, false); // false means metadata didn't change (we already notified that inside the if block)

	// we need to broadcast an update for lyrics (unconditional) too
	if (metadataChanged)
		emitter.emit("lyrics");
}

function hasMetadataChanged(oldMetadata: Metadata, newMetadata?: Metadata): boolean {
	if (!newMetadata)
		return true;

	let metadataChanged = false;

	for (let key in oldMetadata) {
		// skip metadata that is not worth checking because the player might report them 'asynchronously'
		if (["artUrl", "artData", "length"].includes(key)) continue;

		if (
			!oldMetadata[key] && newMetadata[key] ||
			(typeof oldMetadata[key] === "string" && oldMetadata[key] !== newMetadata[key]) ||
			(Array.isArray(oldMetadata[key]) && oldMetadata[key]
				.filter(x => !newMetadata[key].includes(x))
				.concat(newMetadata[key].filter(x => !oldMetadata[key].includes(x))).length !== 0)
		) {
			metadataChanged = true;
			break;
		}
	}

	return metadataChanged;
}

async function pollSpotifyDetails(metadata: Metadata): Promise<SpotifyInfo | undefined> {
	if (!metadata.id) return undefined;

	const spotiMatch = spotiId.exec(metadata.id);

	if (spotiMatch){
		return await getSpotifySongFromId(spotiMatch[0]) || {
			id: spotiMatch[0],
			uri: "spotify:track:" + spotiMatch[0],
			external_urls: { spotify: "https://open.spotify.com/track/" + spotiMatch[0] },
		};
	}

	return await searchSpotifySong() || undefined;
}

// ------ SONG DATA
emitter.on("songdata", (_songdata, metadataChanged) => {
	debug(1, "broadcastSongData called with", metadataChanged);
	//debug(songdata);
});

export async function pollPosition() {
	// Position tracking is now handled by the unified position manager
	// This function is kept for backward compatibility but simplified
	if (songdata.status === "Playing"){
		const state = positionManager.getPosition();
		songdata.elapsed = {
			howMuch: state.interpolatedPosition,
			when: state.timestamp
		};
		songdata.reportsPosition = songdata.elapsed.howMuch > 0;
	}

	// calls
	emitter.emit("position", songdata.elapsed, songdata.reportsPosition);
}

// Helper function to parse lyrics for event dispatcher
function parseLyricsForEventDispatcher(lyrics: Lyrics): Array<{ time?: number; text: string; }> {
	if (!lyrics || typeof lyrics === 'object' && lyrics.unavailable) return [];

	const lines: Array<{ time?: number; text: string; }> = [];

	if (typeof lyrics === 'object' && lyrics.lines) {
		// Convert Lyrics object to array format
		lyrics.lines.forEach(line => {
			lines.push({
				time: line.time,
				text: line.text
			});
		});
	}
	// Note: string lyrics are not currently supported in the Lyrics type
	// This branch is kept for potential future compatibility

	return lines;
}
