import { debug } from "../";
import { ArtData, Metadata, Update, JellyfinConfig } from "../../types";
import { get } from "../config";
import axios from "axios";
import Vibrant from "node-vibrant";
import sharp from "sharp";

let jellyfin: any;
let api: any;
let config: JellyfinConfig;
let updateCallback: Function;
let currentSession: any | null = null;
let currentItem: any | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastPositionUpdate: { position: number; timestamp: Date; wasPlaying: boolean } | null = null;

// Dynamic import variables
let Jellyfin: any;
let getSessionApi: any;
let getLyricsApi: any;
let PlaystateCommand: any;

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
		getLyricsApi = apiModule.getLyricsApi;
		PlaystateCommand = clientModule.PlaystateCommand;

		// Initialize Jellyfin SDK
		jellyfin = new Jellyfin({
			clientInfo: {
				name: "Sunamu",
				version: "2.2.0"
			},
			deviceInfo: {
				name: "Sunamu Device",
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

	// Poll for session changes every 2 seconds
	pollInterval = setInterval(async () => {
		try {
			await checkCurrentSession();
		} catch (error) {
			debug("Jellyfin: Error checking session", error);
		}
	}, 2000);
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

			// Always update position tracking for smooth GetPosition()
			const positionTicks = currentSession.PlayState?.PositionTicks || 0;
			lastPositionUpdate = {
				position: positionTicks / 10000000,
				timestamp: new Date(),
				wasPlaying: isPlaying
			};

			// Only trigger UI update for significant events
			if (isNewTrack) {
				debug("Jellyfin: New track detected", currentItem.Name);
				updateCallback(await getUpdate());
			} else if (playStateChanged) {
				debug("Jellyfin: Play state changed:", isPlaying ? "Playing" : "Paused");
				updateCallback(await getUpdate());
			}
			// Position updates will be handled by the system's pollPosition() calling GetPosition()
		} else {
			if (currentSession) {
				debug("Jellyfin: Music stopped");
				currentSession = null;
				currentItem = null;
				lastPositionUpdate = null;
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

	// Try to get lyrics from Jellyfin using the proper lyrics API
	let lyrics: string | undefined;
	try {
		if (item.Id && api && getLyricsApi) {
			debug("Jellyfin: Attempting to fetch lyrics for item", item.Id);
			const lyricsApi = getLyricsApi(api);
			const lyricsResponse = await lyricsApi.getLyrics({
				itemId: item.Id
			});
			debug("Jellyfin: Lyrics API response:", lyricsResponse.data);

			if (lyricsResponse.data && lyricsResponse.data.Lyrics && Array.isArray(lyricsResponse.data.Lyrics)) {
				// Convert Jellyfin lyrics format to LRC format
				const lrcLines = lyricsResponse.data.Lyrics.map((lyric: any) => {
					// Convert from 100-nanosecond ticks to milliseconds
					const timeMs = Math.round(lyric.Start / 10000);
					const minutes = Math.floor(timeMs / 60000);
					const seconds = Math.floor((timeMs % 60000) / 1000);
					const centiseconds = Math.floor((timeMs % 1000) / 10);

					const timeTag = `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}]`;
					// Keep empty text as empty for animation - don't replace with empty string
					return `${timeTag}${lyric.Text || ''}`;
				});

				// Add an empty lyric at the beginning if the first lyric doesn't start at 0
				if (lyricsResponse.data.Lyrics.length > 0) {
					const firstLyricStart = lyricsResponse.data.Lyrics[0].Start;
					if (firstLyricStart > 0) {
						// Add an empty lyric at 00:00.00 to trigger animation before first lyric
						lrcLines.unshift('[00:00.00]');
						debug("Jellyfin: Added pre-lyric animation period");
					}
				}

				lyrics = lrcLines.join('\n');
				debug("Jellyfin: Converted lyrics to LRC format with", lrcLines.length, "lines");
				debug("Jellyfin: Sample LRC lines:", lrcLines.slice(0, 3).join(' | '));
			}
		}
	} catch (error) {
		// Lyrics not available, that's okay
		debug("Jellyfin: No lyrics found for track", error);
	}

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
	if (!lastPositionUpdate) {
		return {
			howMuch: 0,
			when: new Date()
		};
	}

	let currentPosition = lastPositionUpdate.position;

	// Only interpolate if the song was playing when we last checked
	if (lastPositionUpdate.wasPlaying && currentSession && !currentSession.PlayState?.IsPaused) {
		const elapsedSinceUpdate = (new Date().getTime() - lastPositionUpdate.timestamp.getTime()) / 1000;
		currentPosition = lastPositionUpdate.position + elapsedSinceUpdate;

		// Don't exceed track length
		if (currentItem?.RunTimeTicks) {
			const trackLength = currentItem.RunTimeTicks / 10000000;
			currentPosition = Math.min(currentPosition, trackLength);
		}
	}

	return {
		howMuch: Math.max(0, currentPosition),
		when: new Date()
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
	lastPositionUpdate = null;
	api = null;
}