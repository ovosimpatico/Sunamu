interface SyncEvent {
	type: string;
	timestamp: number;
	data?: any;
}

interface LyricsSyncEvent extends SyncEvent {
	type: "lyrics.sync";
	position: number;
	lineIndex: number;
	wordIndex?: number;
}

interface PositionUpdateEvent extends SyncEvent {
	type: "position.update";
	position: number;
	isPlaying: boolean;
	accuracy: "high" | "medium" | "low";
}

interface PlaybackStateEvent extends SyncEvent {
	type: "playback.state";
	state: "playing" | "paused" | "stopped";
	position: number;
}

class ClientEventDispatcher {
	private listeners: Map<string, Function[]> = new Map();
	private isConnected = false;

	constructor() {
		this.setupEventListeners();
	}

	private setupEventListeners() {
		// Register callbacks with the native player interface
		if (window.np) {
			// High-precision lyrics sync events
			window.np.registerLyricsSyncCallback?.((event: LyricsSyncEvent) => {
				this.emit("lyrics.sync", event);
			});

			// High-precision position events
			window.np.registerPrecisePositionCallback?.((position: number, isPlaying: boolean) => {
				this.emit("position.precise", {
					type: "position.update",
					timestamp: Date.now(),
					position,
					isPlaying,
					accuracy: "high"
				} as PositionUpdateEvent);
			});

			// Playback state events
			window.np.registerPlaybackStateCallback?.((event: PlaybackStateEvent) => {
				this.emit("playback.state", event);
			});

			this.isConnected = true;
		}
	}

	// Event emitter functionality
	on(event: string, callback: Function) {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, []);
		}
		this.listeners.get(event)!.push(callback);
	}

	off(event: string, callback: Function) {
		const eventListeners = this.listeners.get(event);
		if (eventListeners) {
			const index = eventListeners.indexOf(callback);
			if (index !== -1) {
				eventListeners.splice(index, 1);
			}
		}
	}

	emit(event: string, data: any) {
		const eventListeners = this.listeners.get(event);
		if (eventListeners) {
			eventListeners.forEach(callback => {
				try {
					callback(data);
				} catch (error) {
					console.error("Error in event listener:", error);
				}
			});
		}
	}

	// Type-safe event listener helpers
	onLyricsSync(callback: (event: LyricsSyncEvent) => void) {
		this.on("lyrics.sync", callback);
	}

	onPositionUpdate(callback: (event: PositionUpdateEvent) => void) {
		this.on("position.precise", callback);
	}

	onPlaybackState(callback: (event: PlaybackStateEvent) => void) {
		this.on("playback.state", callback);
	}

	// Remove all listeners
	removeAllListeners() {
		this.listeners.clear();
	}

	// Check if connected to backend events
	get connected(): boolean {
		return this.isConnected;
	}
}

// Singleton instance
export const clientEventDispatcher = new ClientEventDispatcher();

// Type-safe helper functions
export function onLyricsSync(callback: (event: LyricsSyncEvent) => void) {
	clientEventDispatcher.onLyricsSync(callback);
}

export function onPositionUpdate(callback: (event: PositionUpdateEvent) => void) {
	clientEventDispatcher.onPositionUpdate(callback);
}

export function onPlaybackState(callback: (event: PlaybackStateEvent) => void) {
	clientEventDispatcher.onPlaybackState(callback);
}

export default clientEventDispatcher;