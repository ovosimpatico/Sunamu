import { debug } from "../";
import { ArtData, Metadata, Update, JellyfinConfig } from "../../types";
import { get } from "../config";
import axios from "axios";
import Vibrant from "node-vibrant";
import sharp from "sharp";
import { positionManager } from "../positionManager";

let jellyfin: any;
let api: any;
let config: JellyfinConfig;
let updateCallback: Function;
let currentSession: any | null = null;
let currentItem: any | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;

// Dynamic import variables
let Jellyfin: any;
let getSessionApi: any;
let PlaystateCommand: any;

// Export API instance for use by lyrics provider
export function getJellyfinApi() {
	return api;
}

export function getJellyfinConfig() {
	return config;
}

export async function init(callback: Function): Promise<void> {
	updateCallback = callback;
	config = get<JellyfinConfig>("jellyfin");

	if (!config.enabled || !config.serverUrl || !config.username || !config.apiKey) {
		debug("Jellyfin: Configuration incomplete, skipping initialization");
		return;
	}

	try {
		// Use runtime dynamic imports to bypass TypeScript's CommonJS transformation
		const jellyfinModule = await (new Function('return import("@jellyfin/sdk")'))();
		const apiModule = await (new Function('return import("@jellyfin/sdk/lib/utils/api/index.js")'))();
		const clientModule = await (new Function('return import("@jellyfin/sdk/lib/generated-client/index.js")'))();

		Jellyfin = jellyfinModule.Jellyfin;
		getSessionApi = apiModule.getSessionApi;
		PlaystateCommand = clientModule.PlaystateCommand;

		// Initialize Jellyfin SDK
		jellyfin = new Jellyfin({
			clientInfo: {
				name: "Sunamu",
				version: "2.3.0"
			},
			deviceInfo: {
				name: "Sunamu-Jellyfin",
				id: "sunamu-" + Math.random().toString(36).substr(2, 9)
			}
		});

		// Create API instance
		api = jellyfin.createApi(config.serverUrl);

		// Authenticate using API key
		api.accessToken = config.apiKey;

		// Start polling for active sessions
		startPolling();
		debug("Jellyfin: Initialized successfully");
	} catch (error) {
		debug("Jellyfin: Failed to initialize", error);
	}
}

async function startPolling() {
	if (pollInterval)
		clearInterval(pollInterval);

	// Poll for session changes every 1 second to match positionPollInterval
	pollInterval = setInterval(async () => {
		try {
			await checkCurrentSession();
		} catch (error) {
			debug("Jellyfin: Error checking session", error);
		}
	}, 1000);
}

async function checkCurrentSession() {
	if (!api || !getSessionApi) return;

	try {
		const sessionApi = getSessionApi(api);
		const sessions = await sessionApi.getSessions();

		// Find active music session for our user
		const musicSession = sessions.data?.find((session: any) =>
			session.UserName === config.username &&
			session.NowPlayingItem?.MediaType === "Audio"
		);

		if (musicSession && musicSession.NowPlayingItem) {
			const isNewTrack = !currentSession || currentSession.Id !== musicSession.Id ||
				!currentItem || currentItem.Id !== musicSession.NowPlayingItem.Id;

			const wasPlaying = currentSession && !currentSession.PlayState?.IsPaused;
			const isPlaying = !musicSession.PlayState?.IsPaused;
			const playStateChanged = wasPlaying !== isPlaying;

			// Update current session data
			currentSession = musicSession;
			currentItem = musicSession.NowPlayingItem;

			// Update position tracking
			const positionTicks = currentSession.PlayState?.PositionTicks || 0;
			const currentPosition = positionTicks / 10000000;

			// Update unified position manager with real position data
			positionManager.updatePosition(currentPosition, isPlaying);

			// Only trigger UI update for significant events
			if (isNewTrack) {
				debug("Jellyfin: New track detected", currentItem.Name);

				const update = await getUpdate();
				updateCallback(update);

				// Update position manager with track info
				if (update?.metadata) {
					positionManager.setTrackInfo(update.metadata.length);
				}
			} else if (playStateChanged) {
				debug("Jellyfin: Play state changed:", isPlaying ? "Playing" : "Paused");
				updateCallback(await getUpdate());
			}
		} else {
			if (currentSession) {
				debug("Jellyfin: Music stopped");
				currentSession = null;
				currentItem = null;

				// Clean up position manager state
				positionManager.updatePosition(0, false);

				updateCallback(null);
			}
		}
	} catch (error) {
		debug("Jellyfin: Error in checkCurrentSession", error);
	}
}

export async function getUpdate(): Promise<Update | null> {
	if (!currentSession || !currentItem || !api)
		return null;

	try {
		const metadata = await parseMetadata(currentItem);

		// Use the actual position from Jellyfin without interpolation
		const positionTicks = currentSession.PlayState?.PositionTicks || 0;
		const currentPosition = positionTicks / 10000000; // Convert from ticks to seconds

		debug("Jellyfin: Position update - Actual:", currentPosition.toFixed(2), "seconds");

		return {
			provider: "Jellyfin",
			metadata,
			capabilities: {
				canControl: true,
				canPlayPause: true,
				canGoNext: true,
				canGoPrevious: true,
				canSeek: true
			},
			status: currentSession.PlayState?.IsPaused ? "Paused" : "Playing",
			loop: "None", // Jellyfin doesn't provide loop status easily
			shuffle: false, // Jellyfin doesn't provide shuffle status easily
			volume: (currentSession.PlayState?.VolumeLevel || 100) / 100,
			elapsed: {
				howMuch: currentPosition,
				when: new Date()
			},
			app: "jellyfin",
			appName: "Jellyfin"
		};
	} catch (error) {
		debug("Jellyfin: Error getting update", error);
		return null;
	}
}

async function parseMetadata(item: any): Promise<Metadata> {
	debug("Jellyfin: Parsing metadata for item", item.Name, "ID:", item.Id);

	let artData: ArtData | undefined;

	// Get album art if available
	if (item.ImageTags?.Primary && api) {
		try {
			const imageUrl = `${config.serverUrl}/Items/${item.Id}/Images/Primary`;
			const response = await axios.get(imageUrl, {
				headers: {
					"X-Emby-Token": config.apiKey
				},
				responseType: "arraybuffer"
			});

			const buffer = Buffer.from(response.data);
			const resizedImage = await sharp(buffer)
				.resize(512, 512, { fit: "inside", withoutEnlargement: true })
				.jpeg({ quality: 90 })
				.toBuffer();

			const palette = await Vibrant.from(resizedImage).getPalette();

			artData = {
				type: ["image/jpeg"],
				data: resizedImage,
				palette: {
					Vibrant: palette.Vibrant?.hex,
					Muted: palette.Muted?.hex,
					DarkVibrant: palette.DarkVibrant?.hex,
					DarkMuted: palette.DarkMuted?.hex,
					LightVibrant: palette.LightVibrant?.hex,
					LightMuted: palette.LightMuted?.hex,
				}
			};
		} catch (error) {
			debug("Jellyfin: Error fetching artwork", error);
		}
	}

	// Lyrics will be fetched by the lyrics provider system
	let lyrics: string | undefined;

	const metadata = {
		title: item.Name || "Unknown Title",
		album: item.Album || "Unknown Album",
		albumArtist: item.AlbumArtist || undefined,
		albumArtists: item.AlbumArtists?.map((artist: any) => artist.Name).filter(Boolean) as string[],
		artist: item.ArtistItems?.[0]?.Name || item.AlbumArtist || "Unknown Artist",
		artists: item.ArtistItems?.map((artist: any) => artist.Name).filter(Boolean) as string[] || [],
		artUrl: item.ImageTags?.Primary ? `${config.serverUrl}/Items/${item.Id}/Images/Primary` : undefined,
		artData,
		length: item.RunTimeTicks ? item.RunTimeTicks / 10000000 : 0, // Convert from ticks to seconds
		lyrics,
		id: item.Id || "",
		location: new URL(`${config.serverUrl}/Items/${item.Id}`)
	};

	debug("Jellyfin: Parsed metadata:", {
		title: metadata.title,
		artist: metadata.artist,
		album: metadata.album,
		id: metadata.id,
		hasLyrics: !!metadata.lyrics,
		location: metadata.location?.href
	});

	return metadata;
}



export async function Play() {
	if (currentSession?.Id && api && getSessionApi && PlaystateCommand) {
		try {
			const sessionApi = getSessionApi(api);
			await sessionApi.sendPlaystateCommand({
				sessionId: currentSession.Id,
				command: PlaystateCommand.Unpause
			});
		} catch (error) {
			debug("Jellyfin: Error sending play command", error);
		}
	}
}

export async function Pause() {
	if (currentSession?.Id && api && getSessionApi && PlaystateCommand) {
		try {
			const sessionApi = getSessionApi(api);
			await sessionApi.sendPlaystateCommand({
				sessionId: currentSession.Id,
				command: PlaystateCommand.Pause
			});
		} catch (error) {
			debug("Jellyfin: Error sending pause command", error);
		}
	}
}

export async function PlayPause() {
	if (currentSession?.PlayState?.IsPaused)
		await Play();
	else
		await Pause();
}

export async function Stop() {
	if (currentSession?.Id && api && getSessionApi && PlaystateCommand) {
		try {
			const sessionApi = getSessionApi(api);
			await sessionApi.sendPlaystateCommand({
				sessionId: currentSession.Id,
				command: PlaystateCommand.Stop
			});
		} catch (error) {
			debug("Jellyfin: Error sending stop command", error);
		}
	}
}

export async function Next() {
	if (currentSession?.Id && api && getSessionApi && PlaystateCommand) {
		try {
			const sessionApi = getSessionApi(api);
			await sessionApi.sendPlaystateCommand({
				sessionId: currentSession.Id,
				command: PlaystateCommand.NextTrack
			});
		} catch (error) {
			debug("Jellyfin: Error sending next command", error);
		}
	}
}

export async function Previous() {
	if (currentSession?.Id && api && getSessionApi && PlaystateCommand) {
		try {
			const sessionApi = getSessionApi(api);
			await sessionApi.sendPlaystateCommand({
				sessionId: currentSession.Id,
				command: PlaystateCommand.PreviousTrack
			});
		} catch (error) {
			debug("Jellyfin: Error sending previous command", error);
		}
	}
}

export function Shuffle() {
	// Jellyfin doesn't have a simple shuffle toggle command
	debug("Jellyfin: Shuffle not implemented");
}

export function Repeat() {
	// Jellyfin doesn't have a simple repeat toggle command
	debug("Jellyfin: Repeat not implemented");
}

export async function Seek(offset: number) {
	if (currentSession?.Id && api && getSessionApi && PlaystateCommand) {
		try {
			const currentPosition = (currentSession.PlayState?.PositionTicks || 0) / 10000000;
			const newPosition = Math.max(0, currentPosition + offset);
			await SetPosition(newPosition);
		} catch (error) {
			debug("Jellyfin: Error seeking", error);
		}
	}
}

export async function SeekPercentage(percentage: number) {
	if (currentItem?.RunTimeTicks && currentSession?.Id && api && getSessionApi && PlaystateCommand) {
		try {
			const totalSeconds = currentItem.RunTimeTicks / 10000000;
			const newPosition = totalSeconds * percentage;
			await SetPosition(newPosition);
		} catch (error) {
			debug("Jellyfin: Error seeking to percentage", error);
		}
	}
}

export async function SetPosition(position: number) {
	if (currentSession?.Id && api && getSessionApi && PlaystateCommand) {
		try {
			const sessionApi = getSessionApi(api);
			await sessionApi.sendPlaystateCommand({
				sessionId: currentSession.Id,
				command: PlaystateCommand.Seek,
				seekPositionTicks: Math.round(position * 10000000)
			});
		} catch (error) {
			debug("Jellyfin: Error setting position", error);
		}
	}
}

export async function GetPosition() {
	// Use the unified position manager for consistent position tracking
	const state = positionManager.getPosition();

	return {
		howMuch: state.interpolatedPosition,
		when: state.timestamp
	};
}

// Cleanup function
export function cleanup() {
	if (pollInterval) {
		clearInterval(pollInterval);
		pollInterval = null;
	}
	currentSession = null;
	currentItem = null;
	api = null;

	// Clean up position manager
	positionManager.updatePosition(0, false);
}