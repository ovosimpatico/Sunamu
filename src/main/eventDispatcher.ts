import { EventEmitter } from "events";
import { logToDebug as debug } from "./logger";
import { positionManager, onPositionUpdate as onPosUpdate, onSeek as onPosSeek } from "./positionManager";

export interface SyncEvent {
	type: string;
	timestamp: number;
	data?: any;
}

export interface LyricsSyncEvent extends SyncEvent {
	type: "lyrics.sync";
	position: number;
	lineIndex: number;
	wordIndex?: number;
}

export interface PositionUpdateEvent extends SyncEvent {
	type: "position.update";
	position: number;
	isPlaying: boolean;
	accuracy: "high" | "medium" | "low";
}

export interface PlaybackStateEvent extends SyncEvent {
	type: "playback.state";
	state: "playing" | "paused" | "stopped";
	position: number;
}

export interface SeekEvent extends SyncEvent {
	type: "position.seek";
	fromPosition: number;
	toPosition: number;
}

export type DispatcherEvent = LyricsSyncEvent | PositionUpdateEvent | PlaybackStateEvent | SeekEvent;

class EventDispatcher extends EventEmitter {
	private lyricsLines: Array<{ time?: number; text: string; }> = [];
	private currentLineIndex = -1;
	private lastSyncPosition = -1;
	private syncThreshold = 0.05; // 50ms threshold for better responsiveness

	constructor() {
		super();
		this.setMaxListeners(50); // Allow many listeners
		this.setupPositionManagerListeners();
	}

	// Setup listeners for the unified position manager
	private setupPositionManagerListeners() {
		// Listen to position updates for lyrics sync
		onPosUpdate((state) => {
			this.checkLyricsSync(state.interpolatedPosition, state.isPlaying);

			// Forward position update events
			this.emit("position.update", {
				type: "position.update",
				timestamp: Date.now(),
				position: state.interpolatedPosition,
				isPlaying: state.isPlaying,
				accuracy: state.confidence === "high" ? "high" : state.confidence === "medium" ? "medium" : "low"
			} as PositionUpdateEvent);
		});

		// Listen to seek events
		onPosSeek((seekEvent) => {
			this.emit("position.seek", {
				type: "position.seek",
				timestamp: Date.now(),
				fromPosition: seekEvent.fromPosition,
				toPosition: seekEvent.toPosition
			} as SeekEvent);

			debug("EventDispatcher: Seek event forwarded from", seekEvent.fromPosition.toFixed(3), "to", seekEvent.toPosition.toFixed(3));
		});

		// Listen to play state changes
		positionManager.on("playStateChange", (isPlaying: boolean) => {
			const state = positionManager.getPosition();
			this.emit("playback.state", {
				type: "playback.state",
				timestamp: Date.now(),
				state: isPlaying ? "playing" : "paused",
				position: state.interpolatedPosition
			} as PlaybackStateEvent);
		});
	}

	// Legacy method for backward compatibility - now delegates to position manager
	updatePosition(position: number, isPlaying: boolean) {
		positionManager.updatePosition(position, isPlaying);
	}

	// Simplified lyrics sync using position manager's compensated position
	private checkLyricsSync(_position: number, isPlaying: boolean) {
		if (!this.lyricsLines.length || !isPlaying) return;

		// Use the position from position manager (already includes compensation)
		const lyricsPosition = positionManager.getLyricsPosition().interpolatedPosition;

		let newLineIndex = -1;

		// Find current line using compensated position
		for (let i = 0; i < this.lyricsLines.length; i++) {
			const line = this.lyricsLines[i];
			const nextLine = this.lyricsLines[i + 1];

			if (line.time !== undefined) {
				// Current line if we're past its start time and before next line's start time
				if (lyricsPosition >= line.time) {
					if (!nextLine || nextLine.time === undefined || lyricsPosition < nextLine.time) {
						newLineIndex = i;
					}
				}
			}
		}

		// Only emit if line actually changed AND position moved forward significantly
		if (newLineIndex !== this.currentLineIndex &&
			Math.abs(lyricsPosition - this.lastSyncPosition) > this.syncThreshold) {

			this.currentLineIndex = newLineIndex;
			this.lastSyncPosition = lyricsPosition;

			this.emit("lyrics.sync", {
				type: "lyrics.sync",
				timestamp: Date.now(),
				position: lyricsPosition,
				lineIndex: newLineIndex,
				wordIndex: -1 // Future use for karaoke
			} as LyricsSyncEvent);

			debug("EventDispatcher: Lyrics sync - line", newLineIndex, "at position", lyricsPosition.toFixed(3));
		}
	}

	// Set track info
	setTrackInfo(length: number, lyricsLines: Array<{ time?: number; text: string; }> = []) {
		this.lyricsLines = lyricsLines;
		this.currentLineIndex = -1;
		this.lastSyncPosition = -1;

		// Also update the position manager
		positionManager.setTrackInfo(length);

		debug("EventDispatcher: Track info updated - length:", length, "lyrics lines:", lyricsLines.length);
	}

	// Set lyrics sync threshold
	setSyncThreshold(threshold: number) {
		this.syncThreshold = threshold;
	}

	// Set compensation - delegates to position manager
	setCompensation(compensationMs: number) {
		positionManager.setCompensation(compensationMs);
		debug("EventDispatcher: Compensation delegated to position manager:", compensationMs, "ms");
	}

	// Get current position - delegates to position manager
	getCurrentPosition(): number {
		return positionManager.getPosition().interpolatedPosition;
	}

	// Get current line index
	getCurrentLineIndex(): number {
		return this.currentLineIndex;
	}

	// Clean up
	cleanup() {
		this.removeAllListeners();
		this.currentLineIndex = -1;
		this.lastSyncPosition = -1;
		positionManager.cleanup();
	}
}

// Singleton instance
export const eventDispatcher = new EventDispatcher();

// Type-safe event listener helpers
export function onLyricsSync(callback: (event: LyricsSyncEvent) => void) {
	eventDispatcher.on("lyrics.sync", callback);
}

export function onPositionUpdate(callback: (event: PositionUpdateEvent) => void) {
	eventDispatcher.on("position.update", callback);
}

export function onPlaybackState(callback: (event: PlaybackStateEvent) => void) {
	eventDispatcher.on("playback.state", callback);
}

export function onPositionSeek(callback: (event: SeekEvent) => void) {
	eventDispatcher.on("position.seek", callback);
}

// Cleanup helper
export function removeAllSyncListeners() {
	eventDispatcher.removeAllListeners();
}

export default eventDispatcher;