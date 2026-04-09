import sharp from "sharp";
import { Update } from "../../types";
import Vibrant from "node-vibrant";
import { info, error, debug } from "../logger";

let _player: any;
let isBroken = false;

export async function init(callback: Function): Promise<void>{
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const Player = require("winplayer-node");
		const _cb = async () => callback(await getUpdate());
		_player = new Player(_cb);
		info("Windows Player: Successfully initialized winplayer-node");
	} catch (e) {
		isBroken = true;
		error("Windows Player: Failed to load winplayer-node. Native media controls will be disabled.", e);
	}
}

export function isFunctional(): boolean {
	return !isBroken && !!_player;
}

export async function getUpdate(): Promise<Update | null> {
	if (!isFunctional()) return null;
	const update: Update = await _player.getUpdate();

	if(update !== null){
		if (update.metadata.artData) {
			try {
				const palettebuffer = await sharp(update.metadata.artData.data)
					.resize(512, 512, { withoutEnlargement: true })
					.png()
					.toBuffer();
				const palette = await (new Vibrant(palettebuffer, {
					colorCount: 16,
					quality: 1
				})).getPalette();
				if (palette) {
					update.metadata.artData.palette = {
						DarkMuted: palette.DarkMuted?.hex,
						DarkVibrant: palette.DarkVibrant?.hex,
						LightMuted: palette.LightMuted?.hex,
						LightVibrant: palette.LightVibrant?.hex,
						Muted: palette.Muted?.hex,
						Vibrant: palette.Vibrant?.hex,
					};
				}
			} catch (e) {
				debug("Couldn't compute palette for image", e);
			}
		}
	}

	return update;
}

export function Play() {
	if (!isFunctional()) return;
	return _player.Play();
}

export function Pause() {
	if (!isFunctional()) return;
	return _player.Pause();
}

export function PlayPause() {
	if (!isFunctional()) return;
	return _player.PlayPause();
}

export function Stop() {
	if (!isFunctional()) return;
	return _player.Stop();
}

export function Next() {
	if (!isFunctional()) return;
	return _player.Next();
}

export function Previous() {
	if (!isFunctional()) return;
	return _player.Previous();
}

export function Shuffle() {
	if (!isFunctional()) return;
	return _player.Shuffle();
}

export function Repeat() {
	if (!isFunctional()) return;
	return _player.Repeat();
}

export function Seek(offset: number) {
	if (!isFunctional()) return;
	return _player.Seek(offset);
}

export function SeekPercentage(percentage: number) {
	if (!isFunctional()) return;
	return _player.SeekPercentage(percentage);
}

export function SetPosition(position: number) {
	if (!isFunctional()) return;
	return _player.SetPosition(position);
}

export async function GetPosition() {
	if (!isFunctional()) return {
		howMuch: 0,
		when: new Date()
	};
	return {
		howMuch: _player.GetPosition(),
		when: new Date()
	};
}
