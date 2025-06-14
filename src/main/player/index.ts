/* eslint-disable no-unused-vars */
import { Position, Update, JellyfinConfig } from "../../types";
import { get } from "../config";

const fallback: Player = {
	init: async (_callback: Function, _denylist?: string[]) => undefined,
	getUpdate: async () => null,
	Play: async () => undefined,
	Pause: async () => undefined,
	PlayPause: async () => undefined,
	Stop: async () => undefined,
	Next: async () => undefined,
	Previous: async () => undefined,
	Shuffle: () => undefined,
	Repeat: () => undefined,
	Seek: async (_offset: number) => undefined,
	SeekPercentage: async (_percentage: number) => undefined,
	SetPosition: async (_position: number) => undefined,
	GetPosition: async () => ({howMuch: 0, when: new Date(0)}),
};

let player: Player;

export default async function getPlayer(){
	if(!player){
		// Check if Jellyfin is enabled and configured
		const jellyfinConfig = get<JellyfinConfig>("jellyfin");
		if (jellyfinConfig.enabled && jellyfinConfig.serverUrl && jellyfinConfig.username && jellyfinConfig.apiKey) {
			let jellyfin = await import("./jellyfin");
			player = Object.assign({}, jellyfin);
		} else {
			switch (process.platform) {
				case "linux":
					let MPRIS2 = await import("./mpris2");
					player = Object.assign({}, MPRIS2);
					break;
				case "win32":
					let winplayer = await import("./winplayer");
					// @ts-ignore
					player = Object.assign({}, winplayer);
					break;
				default:
					console.error("Player: Unsupported platform!");
					player = Object.assign({}, fallback);
					break;
			}
		}
	}

	return player;
}

export interface Player {
	init(callback: Function, denylist?: string[]): Promise<void>
	getUpdate(): Promise<Update | null>

	Play(): Promise<void | boolean>
	Pause(): Promise<void | boolean>
	PlayPause(): Promise<void | boolean>
	Stop(): Promise<void | boolean>

	Next(): Promise<void | boolean>
	Previous(): Promise<void | boolean>

	Shuffle(): void | Promise<boolean>
	Repeat(): void | Promise<boolean>

	Seek(offset: number): Promise<void | boolean>
	SeekPercentage(percentage: number): Promise<void | boolean>
	GetPosition(): Promise<Position>
	SetPosition(position: number): Promise<void | boolean>
}