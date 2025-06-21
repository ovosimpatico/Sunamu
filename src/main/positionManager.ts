import { EventEmitter } from "events";
import { debug } from ".";
import { get } from "./config";

export interface PositionState {
	actualPosition: number;
	interpolatedPosition: number;
	timestamp: Date;
	isPlaying: boolean;
	isInterpolating: boolean;
	confidence: "high" | "medium" | "low";
}

export interface SeekEvent {
	fromPosition: number;
	toPosition: number;
	timestamp: Date;
	confidence: "high" | "medium" | "low";
}

/**
 * Unified Position Manager
 *
 * This class consolidates all position tracking, interpolation, and seek detection
 * into a single system to eliminate conflicts between different polling mechanisms.
 */
class PositionManager extends EventEmitter {
	private currentState: PositionState = {
		actualPosition: 0,
		interpolatedPosition: 0,
		timestamp: new Date(),
		isPlaying: false,
		isInterpolating: false,
		confidence: "low"
	};

	private trackLength = 0;
	private maxInterpolationSeconds = 2.0; // Maximum interpolation before marking as low confidence
	private seekThreshold = 1.0; // Position change threshold to consider as seek (in seconds)
	private compensationMs = 200; // Base compensation for lyrics/UI delays

	// Position update tracking
	private positionHistory: Array<{ position: number; timestamp: Date; isPlaying: boolean }> = [];
	private maxHistorySize = 5;

	// Polling control
	private pollTimer: NodeJS.Timeout | null = null;
	private playerGetPosition: (() => Promise<{ howMuch: number; when: Date }>) | null = null;

	constructor() {
		super();
		this.compensationMs = get<number>("lyricsCompensationMs") || 200;
		this.maxInterpolationSeconds = Math.max(1.0, get<number>("positionPollInterval") * 2);
		this.seekThreshold = Math.max(0.5, get<number>("positionPollInterval") * 0.5);
	}

	/**
	 * Initialize the position manager with a player's GetPosition function
	 */
	public initialize(getPositionFn: () => Promise<{ howMuch: number; when: Date }>) {
		this.playerGetPosition = getPositionFn;
		this.startPolling();
		debug("PositionManager: Initialized with unified polling");
	}

	/**
	 * Set track information
	 */
	public setTrackInfo(length: number) {
		this.trackLength = length;
		this.resetState();
		debug("PositionManager: Track info updated - length:", length);
	}

	/**
	 * Update position from external source (e.g., player events)
	 * This should be the primary way to update position
	 */
	public updatePosition(position: number, isPlaying: boolean, timestamp?: Date): void {
		const now = timestamp || new Date();
		const wasPlaying = this.currentState.isPlaying;
		const oldPosition = this.currentState.actualPosition;

		// Add to history for trend analysis
		this.addToHistory(position, now, isPlaying);

		// Check for seek
		const positionDiff = Math.abs(position - this.currentState.actualPosition);
		const timeDiff = (now.getTime() - this.currentState.timestamp.getTime()) / 1000;

		// Consider it a seek if position jumped more than expected
		const expectedPosition = this.currentState.actualPosition + (wasPlaying ? timeDiff : 0);
		const isSeek = positionDiff > this.seekThreshold && Math.abs(position - expectedPosition) > this.seekThreshold;

		if (isSeek && oldPosition > 0) {
			this.emit("seek", {
				fromPosition: oldPosition,
				toPosition: position,
				timestamp: now,
				confidence: "high"
			} as SeekEvent);
			debug("PositionManager: Seek detected from", oldPosition.toFixed(3), "to", position.toFixed(3));
		}

		// Update state
		this.currentState = {
			actualPosition: position,
			interpolatedPosition: position,
			timestamp: now,
			isPlaying,
			isInterpolating: false,
			confidence: "high"
		};



		// Emit events
		if (wasPlaying !== isPlaying) {
			this.emit("playStateChange", isPlaying);
		}

		this.emit("positionUpdate", this.getPosition());
	}

	/**
	 * Get current position with smart interpolation and compensation
	 */
	public getPosition(withCompensation = false): PositionState {
		const now = new Date();
		const timeDiff = (now.getTime() - this.currentState.timestamp.getTime()) / 1000;

		let position = this.currentState.actualPosition;
		let isInterpolating = false;
		let confidence = this.currentState.confidence;

		// Apply interpolation if playing and not too much time has passed
		if (this.currentState.isPlaying && timeDiff > 0.01) { // Only interpolate after 10ms
			if (timeDiff <= this.maxInterpolationSeconds) {
				position += timeDiff;
				isInterpolating = true;

				// Reduce confidence based on interpolation age
				if (timeDiff > this.maxInterpolationSeconds * 0.5) {
					confidence = "medium";
				}
				if (timeDiff > this.maxInterpolationSeconds * 0.8) {
					confidence = "low";
				}
			} else {
				// Too much time passed, mark as low confidence
				confidence = "low";
			}
		}

		// Apply compensation for UI/lyrics timing if requested
		if (withCompensation && this.currentState.isPlaying) {
			position += this.compensationMs / 1000;
		}

		// Clamp to track bounds
		position = Math.max(0, Math.min(position, this.trackLength));

		return {
			actualPosition: this.currentState.actualPosition,
			interpolatedPosition: position,
			timestamp: now,
			isPlaying: this.currentState.isPlaying,
			isInterpolating,
			confidence
		};
	}

	/**
	 * Get position specifically for lyrics with compensation
	 */
	public getLyricsPosition(): PositionState {
		return this.getPosition(true);
	}

	/**
	 * Set compensation value (for runtime adjustment)
	 */
	public setCompensation(compensationMs: number): void {
		this.compensationMs = Math.max(0, Math.min(2000, compensationMs));
		debug("PositionManager: Compensation set to", this.compensationMs, "ms");
	}

	/**
	 * Start internal polling for position updates
	 */
	private startPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
		}

		const interval = get<number>("positionPollInterval") * 1000;
		this.pollTimer = setInterval(async () => {
			if (this.playerGetPosition) {
				try {
					const position = await this.playerGetPosition();
					this.updatePosition(position.howMuch, this.currentState.isPlaying, position.when);
				} catch (error) {
					debug("PositionManager: Error polling position", error);
				}
			}
		}, interval);

		debug("PositionManager: Started polling with", interval, "ms interval");
	}

	/**
	 * Add position to history for analysis
	 */
	private addToHistory(position: number, timestamp: Date, isPlaying: boolean): void {
		this.positionHistory.push({ position, timestamp, isPlaying });

		// Keep only recent history
		if (this.positionHistory.length > this.maxHistorySize) {
			this.positionHistory.shift();
		}
	}

	/**
	 * Reset state (e.g., when track changes)
	 */
	private resetState(): void {
		this.currentState = {
			actualPosition: 0,
			interpolatedPosition: 0,
			timestamp: new Date(),
			isPlaying: false,
			isInterpolating: false,
			confidence: "low"
		};
		this.positionHistory = [];
	}

	/**
	 * Cleanup resources
	 */
	public cleanup(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		this.removeAllListeners();
		this.resetState();
		debug("PositionManager: Cleaned up");
	}

	/**
	 * Get current playing state
	 */
	public isPlaying(): boolean {
		return this.currentState.isPlaying;
	}

	/**
	 * Get track length
	 */
	public getTrackLength(): number {
		return this.trackLength;
	}
}

// Singleton instance
export const positionManager = new PositionManager();

// Type-safe event listeners
export function onPositionUpdate(callback: (state: PositionState) => void) {
	positionManager.on("positionUpdate", callback);
}

export function onSeek(callback: (event: SeekEvent) => void) {
	positionManager.on("seek", callback);
}

export function onPlayStateChange(callback: (isPlaying: boolean) => void) {
	positionManager.on("playStateChange", callback);
}

export default positionManager;