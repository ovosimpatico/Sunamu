import { execFile } from "child_process";
import { promisify } from "util";
import { ArtData, Update } from "../../types";
import { debug } from "..";
import sharp from "sharp";
import Vibrant from "node-vibrant";

const execFileAsync = promisify(execFile);

let updateCallback: Function;
let lastUpdateHash: string | undefined;
let nowplayingCliPath: string | undefined;

// Cached position data — updated every 1s poll, read every 200ms by GetPosition()
let cachedElapsed = 0;
let cachedElapsedWhen = new Date();


const POLL_INTERVAL_MS = 1000;

const PROPS = [
	"title", "artist", "album", "duration",
	"playbackRate", "shuffleMode", "repeatMode", "uniqueIdentifier",
	"artworkData", "artworkMIMEType", "clientBundleIdentifier"
];

// Bundle ID -> AppleScript app name mapping for position queries
const BUNDLE_TO_APP: { [key: string]: string } = {
	"com.apple.Music": "Music",
	"com.spotify.client": "Spotify",
	"com.apple.iTunes": "iTunes",
};

let currentAppBundleId: string | undefined;

async function findNowPlayingCli(): Promise<string | undefined> {
	if (nowplayingCliPath) return nowplayingCliPath;

	const candidates = [
		"/opt/homebrew/bin/nowplaying-cli",
		"/usr/local/bin/nowplaying-cli",
	];

	for (const path of candidates) {
		try {
			await execFileAsync(path, ["get", "title"], { timeout: 3000 });
			nowplayingCliPath = path;
			return path;
		} catch (e: any) {
			// exit code != 0 is fine (no media playing), just means the binary exists
			if (e.code !== "ENOENT") {
				nowplayingCliPath = path;
				return path;
			}
		}
	}

	// Try PATH lookup
	try {
		const { stdout } = await execFileAsync("/usr/bin/which", ["nowplaying-cli"], { timeout: 3000 });
		const path = stdout.trim();
		if (path) {
			nowplayingCliPath = path;
			return path;
		}
	} catch (_) {
		// not found
	}

	return undefined;
}

async function runNowPlaying(args: string[]): Promise<string> {
	const cli = await findNowPlayingCli();
	if (!cli) throw new Error("nowplaying-cli not found");

	const { stdout } = await execFileAsync(cli, args, { timeout: 5000 });
	return stdout;
}

async function getPositionViaOsascript(): Promise<number> {
	if (!currentAppBundleId) return 0;
	const appName = BUNDLE_TO_APP[currentAppBundleId];
	if (!appName) return 0;

	try {
        // Quick check to ensure the app is actually running before polling position
		const { stdout: isRunning } = await execFileAsync("/usr/bin/osascript", [
			"-e", `tell application "System Events" to (name of processes) contains "${appName}"`
		], { timeout: 1000 });
		
        if (isRunning.trim() !== "true") return 0;

		const { stdout } = await execFileAsync("/usr/bin/osascript", [
			"-e", `tell application "${appName}" to get player position`
		], { timeout: 2000 });
		return parseFloat(stdout.trim()) || 0;
	} catch (_) {
		return 0;
	}
}

export async function init(callback: Function): Promise<void> {
	updateCallback = callback;

	const cli = await findNowPlayingCli();
	if (!cli) {
		console.error(
			"macOS Player: nowplaying-cli not found!\n" +
			"Install it with: brew install nowplaying-cli\n" +
			"See https://github.com/kirtan-shah/nowplaying-cli"
		);
		return;
	}

	debug("macOS Player: Using nowplaying-cli at", cli);

	// Start polling for changes
	setInterval(async () => {
		try {
			const update = await getUpdate();
			const hash = update ? computeHash(update) : "";

			if (hash !== lastUpdateHash) {
				lastUpdateHash = hash;
				updateCallback(update);
			}
		} catch (e) {
			// Silently continue on poll errors
		}
	}, POLL_INTERVAL_MS);
}

function computeHash(update: Update): string {
	// Hash based on metadata that matters for change detection
	return `${update.metadata.id}|${update.metadata.title}|${update.metadata.artist}|${update.status}`;
}

export async function getUpdate(): Promise<Update | null> {
	try {
		const stdout = await runNowPlaying(["get", ...PROPS]);
		const lines = stdout.split("\n");

		// nowplaying-cli outputs one value per line, in the same order as requested
		// A "null" value means the property is not available
		const values: { [key: string]: string | undefined } = {};
		for (let i = 0; i < PROPS.length && i < lines.length; i++) {
			const val = lines[i].trim();
			values[PROPS[i]] = (val === "null" || val === "") ? undefined : val;
		}

		// If there's no title, nothing is playing
		if (!values.title) return null;

		// Detect which app is playing (needed for osascript position queries)
		if (values.clientBundleIdentifier) {
			currentAppBundleId = values.clientBundleIdentifier;
		}

		const playbackRate = parseFloat(values.playbackRate || "0");
		const duration = parseFloat(values.duration || "0");

		// Get real position via osascript (nowplaying-cli elapsedTime is always 0)
		const elapsedTime = await getPositionViaOsascript();

		// Cache position for fast GetPosition() calls
		cachedElapsed = elapsedTime;
		cachedElapsedWhen = new Date();

		// Parse artwork
		let artData: ArtData | undefined;
		if (values.artworkData) {
			try {
				const artBuffer = Buffer.from(values.artworkData, "base64");
				const artType = values.artworkMIMEType || "application/octet-stream";

				artData = {
					data: artBuffer,
					type: [artType],
				};

				try {
					const palettebuffer = await sharp(artBuffer)
						.resize(512, 512, { withoutEnlargement: true })
						.png()
						.toBuffer();
					const palette = await (new Vibrant(palettebuffer, {
						colorCount: 16,
						quality: 1
					})).getPalette();
					artData.palette = {
						DarkMuted: palette.DarkMuted?.hex,
						DarkVibrant: palette.DarkVibrant?.hex,
						LightMuted: palette.LightMuted?.hex,
						LightVibrant: palette.LightVibrant?.hex,
						Muted: palette.Muted?.hex,
						Vibrant: palette.Vibrant?.hex,
					};
				} catch (e) {
					debug("macOS Player: Couldn't compute palette for image", e);
				}
			} catch (e) {
				debug("macOS Player: Failed to parse artwork data", e);
			}
		}

		// Map shuffle mode
		const shuffleMode = parseInt(values.shuffleMode || "0");
		const shuffle = shuffleMode > 0;

		// Map repeat mode: 0 = None, 1 = One/Track, 2 = All/Playlist
		const repeatMode = parseInt(values.repeatMode || "0");
		let loop = "None";
		if (repeatMode === 1) loop = "Track";
		else if (repeatMode === 2) loop = "Playlist";

		const status = playbackRate > 0 ? "Playing" : "Paused";

		const update: Update = {
			provider: "MPRIS2", // Re-use the union type; macOS identified by appName
			metadata: {
				title: values.title || "",
				artist: values.artist || "",
				artists: values.artist ? [values.artist] : [],
				album: values.album || "",
				length: duration,
				artData: artData || undefined,
				id: values.uniqueIdentifier || `macos:${values.title}:${values.artist}`
			},
			capabilities: {
				canControl: true,
				canPlayPause: true,
				canGoNext: true,
				canGoPrevious: true,
				canSeek: true
			},
			status,
			loop,
			shuffle,
			volume: 1,
			elapsed: {
				howMuch: elapsedTime,
				when: new Date()
			},
			app: currentAppBundleId || "macOS Now Playing",
			appName: BUNDLE_TO_APP[currentAppBundleId || ""] || "macOS"
		};

		return update;
	} catch (_) {
		return null;
	}
}

export async function Play(): Promise<void> {
	try { await runNowPlaying(["play"]); } catch (_) { /* */ }
}

export async function Pause(): Promise<void> {
	try { await runNowPlaying(["pause"]); } catch (_) { /* */ }
}

export async function PlayPause(): Promise<void> {
	try { await runNowPlaying(["togglePlayPause"]); } catch (_) { /* */ }
}

export async function Stop(): Promise<void> {
	try { await runNowPlaying(["pause"]); } catch (_) { /* */ }
}

export async function Next(): Promise<void> {
	try { await runNowPlaying(["next"]); } catch (_) { /* */ }
}

export async function Previous(): Promise<void> {
	try { await runNowPlaying(["previous"]); } catch (_) { /* */ }
}

export function Shuffle(): void {
	// nowplaying-cli doesn't support toggling shuffle
	debug("macOS Player: Shuffle toggle not supported via nowplaying-cli");
}

export function Repeat(): void {
	// nowplaying-cli doesn't support toggling repeat
	debug("macOS Player: Repeat toggle not supported via nowplaying-cli");
}

export async function Seek(offset: number): Promise<void> {
	try {
		const pos = await GetPosition();
		const newPos = pos.howMuch + offset;
		await runNowPlaying(["seek", String(Math.max(0, newPos))]);
	} catch (_) { /* */ }
}

export async function SeekPercentage(percentage: number): Promise<void> {
	try {
		const update = await getUpdate();
		if (update && update.metadata.length) {
			const target = update.metadata.length * percentage;
			await runNowPlaying(["seek", String(Math.max(0, target))]);
		}
	} catch (_) { /* */ }
}

export async function SetPosition(position: number): Promise<void> {
	try {
		await runNowPlaying(["seek", String(Math.max(0, position))]);
	} catch (_) { /* */ }
}

export async function GetPosition(): Promise<{ howMuch: number; when: Date }> {
	// Use osascript for real-time position (fast, ~20ms per call)
	const pos = await getPositionViaOsascript();
	if (pos > 0) {
		cachedElapsed = pos;
		cachedElapsedWhen = new Date();
	}
	return { howMuch: cachedElapsed, when: cachedElapsedWhen };
}
