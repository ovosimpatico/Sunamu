import { Lyrics, Metadata } from "../../types";
import { parseLrc } from "./lrc";
import { debug } from "../";
import { getJellyfinApi, getJellyfinConfig } from "../player/jellyfin";

export const name = "Jellyfin";
export const supportedPlatforms = ["linux", "win32", "darwin"];

// Dynamic import variable
let getLyricsApi: any;

export async function query(metadata: Metadata): Promise<Lyrics | undefined> {
	debug("Jellyfin lyrics provider: Starting query for", metadata.title, "by", metadata.artist);

	const config = getJellyfinConfig();
	const api = getJellyfinApi();

	if (!config?.enabled || !config.serverUrl || !config.apiKey || !api) {
		debug("Jellyfin lyrics provider: Not enabled, missing config, or API not initialized");
		return undefined;
	}

	// Initialize getLyricsApi if needed
	if (!getLyricsApi) {
		try {
			const apiModule = await (new Function('return import("@jellyfin/sdk/lib/utils/api/index.js")'))();
			getLyricsApi = apiModule.getLyricsApi;
		} catch (error) {
			debug("Jellyfin lyrics provider: Failed to import getLyricsApi", error);
			return undefined;
		}
	}

	// If we have a Jellyfin item ID, try to fetch lyrics directly
	if (metadata.id && metadata.location?.hostname) {
		debug("Jellyfin lyrics provider: Attempting to fetch lyrics for item ID", metadata.id);
		try {
			const lyricsApi = getLyricsApi(api);
			const lyricsResponse = await lyricsApi.getLyrics({
				itemId: metadata.id
			});

			debug("Jellyfin lyrics provider: API response received", lyricsResponse.data);

			if (lyricsResponse.data && lyricsResponse.data.Lyrics && Array.isArray(lyricsResponse.data.Lyrics)) {
				debug("Jellyfin lyrics provider: Found lyrics in API response");

				// Convert Jellyfin lyrics format to LRC format
				const lrcLines = lyricsResponse.data.Lyrics.map((lyric: any) => {
					// Convert from 100-nanosecond ticks to milliseconds
					const timeMs = Math.round(lyric.Start / 10000);
					const minutes = Math.floor(timeMs / 60000);
					const seconds = Math.floor((timeMs % 60000) / 1000);
					const centiseconds = Math.floor((timeMs % 1000) / 10);

					const timeTag = `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}]`;
					return `${timeTag}${lyric.Text || ''}`;
				});

				// Add an empty lyric at the beginning if the first lyric doesn't start at 0
				if (lyricsResponse.data.Lyrics.length > 0) {
					const firstLyricStart = lyricsResponse.data.Lyrics[0].Start;
					if (firstLyricStart > 0) {
						lrcLines.unshift('[00:00.00]');
						debug("Jellyfin lyrics provider: Added pre-lyric animation period");
					}
				}

				const lyricsText = lrcLines.join('\n');
				const lrcData = parseLrc(lyricsText);
				debug("Jellyfin lyrics provider: Converted lyrics to LRC format with", lrcLines.length, "lines");

				return {
					provider: "Jellyfin",
					synchronized: lrcData.lines.length > 0 && lrcData.lines.some(line => line.time !== undefined),
					lines: lrcData.lines,
					copyright: lrcData.metadata.ar ? `Artist: ${lrcData.metadata.ar}` : undefined
				};
			} else {
				debug("Jellyfin lyrics provider: No lyrics found in API response");
			}
		} catch (error) {
			debug("Jellyfin lyrics provider: Failed to fetch lyrics", error);
		}
	} else {
		debug("Jellyfin lyrics provider: Missing required data for API call", {
			hasId: !!metadata.id,
			hasLocation: !!metadata.location?.hostname
		});
	}

	debug("Jellyfin lyrics provider: No lyrics found");
	return undefined;
}