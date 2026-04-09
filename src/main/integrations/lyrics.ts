import { debug } from "../";
import { get as getLyrics, save as saveLyrics } from "./lyricsOffline";
import { get as getConfig } from "../config";

import { query as AppleMusic } from "../lyricproviders/applemusic";
import { query as Deezer } from "../lyricproviders/deezer";
import { query as LRCLIB } from "../lyricproviders/lrclib";
import { Lyrics, Metadata } from "../../types";

export async function queryLyrics(metadata: Metadata): Promise<Lyrics | undefined> {
	if (!metadata.artist || !metadata.title) // there can't be lyrics without at least those two fields
		return;
	
	let lyrics: Lyrics | undefined;
	const id = computeLyricsID(metadata);

	const cached = await getLyrics(id);

	// This should only be executed inside the electron (main/renderer) process
	if (!cached || !cached.lines.length || !cached?.synchronized) {
		if (!cached) debug(`Cache miss for ${metadata.artist} - ${metadata.title}`);
		else if (!cached?.synchronized) debug(`Cache hit but unsynced lyrics. Trying to fetch synchronized lyrics for ${metadata.artist} - ${metadata.title}`);

		const providers: any = {
			AppleMusic
		};

		if (getConfig("deezerSearch")) providers.Deezer = Deezer;
		if (getConfig("lrclibFallback")) providers.LRCLIB = LRCLIB;

		for (const provider in providers) {
			debug("Fetching from " + provider);
			const _lyrics = await providers[provider](metadata);
			if (_lyrics?.lines.length){
				lyrics = _lyrics;
				if (_lyrics.synchronized) break;
			}
		}

		if (lyrics){
			saveLyrics(id, lyrics);
			debug("Fetched from " + lyrics.provider);
		}else
			debug("Unable to fetch lyrics");
		
	}

	if(cached && !lyrics)
		lyrics = cached;

	return lyrics;
}

function computeLyricsID(metadata: Metadata){
	return `${metadata.artist}:${metadata.album}:${metadata.title}`;
}
