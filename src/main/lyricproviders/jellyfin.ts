import { get } from "../config";
import { JellyfinConfig, Lyrics, Metadata } from "../../types";
import { parseLrc } from "./lrc";
import { debug } from "../";

export const name = "Jellyfin";
export const supportedPlatforms = ["linux", "win32", "darwin"];

let jellyfin: any;
let api: any;

// Dynamic import variables
let Jellyfin: any;
let getLyricsApi: any;

export async function query(metadata: Metadata): Promise<Lyrics | undefined> {
	debug("Jellyfin lyrics provider: Starting query for", metadata.title, "by", metadata.artist);

	const config = get<JellyfinConfig>("jellyfin");

	if (!config.enabled || !config.serverUrl || !config.apiKey) {
		debug("Jellyfin lyrics provider: Not enabled or missing config");
		return undefined;
	}

	// Initialize if not already done
	if (!jellyfin || !api) {
		try {
			debug("Jellyfin lyrics provider: Initializing SDK");
			// Use runtime dynamic imports to bypass TypeScript's CommonJS transformation
			if (!Jellyfin || !getLyricsApi) {
				const jellyfinModule = await (new Function('return import("@jellyfin/sdk")'))();
				const apiModule = await (new Function('return import("@jellyfin/sdk/lib/utils/api/index.js")'))();

				Jellyfin = jellyfinModule.Jellyfin;
				getLyricsApi = apiModule.getLyricsApi;
			}

			jellyfin = new Jellyfin({
				clientInfo: {
					name: "Sunamu",
					version: "2.2.0"
				},
				deviceInfo: {
					name: "Sunamu Device",
					id: "sunamu-lyrics-" + Math.random().toString(36).substr(2, 9)
				}
			});

			api = jellyfin.createApi(config.serverUrl);
			api.accessToken = config.apiKey;
			debug("Jellyfin lyrics provider: SDK initialized successfully");
		} catch (error) {
			debug("Jellyfin lyrics provider: Failed to initialize", error);
			return undefined;
		}
	}

	// If this metadata came from Jellyfin and already has lyrics, parse them
	if (metadata.lyrics) {
		debug("Jellyfin lyrics provider: Found lyrics in metadata, parsing");
		try {
			const lrcData = parseLrc(metadata.lyrics);
			debug("Jellyfin lyrics provider: Successfully parsed LRC lyrics, lines:", lrcData.lines.length);
			const result = {
				provider: "Jellyfin",
				synchronized: lrcData.lines.length > 0 && lrcData.lines.some(line => line.time !== undefined),
				lines: lrcData.lines,
				copyright: lrcData.metadata.ar ? `Artist: ${lrcData.metadata.ar}` : undefined
			};
			debug("Jellyfin lyrics provider: Returning lyrics result:", {
				provider: result.provider,
				synchronized: result.synchronized,
				lineCount: result.lines?.length || 0
			});
			return result;
		} catch (error) {
			debug("Jellyfin lyrics provider: Failed to parse LRC", error);
		}
	} else {
		debug("Jellyfin lyrics provider: No lyrics found in metadata");
	}

	// If we have a Jellyfin item ID, try to fetch lyrics directly
	if (metadata.id && metadata.location?.hostname && getLyricsApi) {
		debug("Jellyfin lyrics provider: Attempting to fetch lyrics for item ID", metadata.id);
		try {
			const lyricsApi = getLyricsApi(api);
			const lyricsResponse = await lyricsApi.getLyrics({
				itemId: metadata.id
			});

			debug("Jellyfin lyrics provider: API response received", lyricsResponse.data);

			if (lyricsResponse.data && lyricsResponse.data.Lyrics) {
				debug("Jellyfin lyrics provider: Found lyrics in API response");
				const lyricsText = lyricsResponse.data.Lyrics.join("\n");
				const lrcData = parseLrc(lyricsText);

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
			hasLocation: !!metadata.location?.hostname,
			hasLyricsApi: !!getLyricsApi
		});
	}

	debug("Jellyfin lyrics provider: No lyrics found");
	return undefined;
}