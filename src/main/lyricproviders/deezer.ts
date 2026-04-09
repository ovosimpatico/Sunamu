import axios from "axios";
import { Lyrics, Metadata, LyricsLine } from "../../types";
import { getDeezerToken, deezerPost } from "../integrations/deezer_auth";
import { debug } from "..";

export async function query(metadata: Metadata): Promise<Lyrics | undefined> {
	try {
		// 1. Search for the song ID using the public API
		const searchUrl = "https://api.deezer.com/search";
		const searchResponse = await axios.get(searchUrl, {
			params: {
				q: `${metadata.artist} ${metadata.title}`,
				limit: 1
			}
		});

		const track = searchResponse.data.data?.[0];
		if (!track) {
			debug("Deezer: Track not found");
			return undefined;
		}

		const songId = track.id;

		// 2. Get anonymous token
		const token = await getDeezerToken();
		if (!token) return undefined;

		// 3. Fetch lyrics via private API
		const lyricsResponse = await deezerPost({
			api_version: "1.0",
			api_token: token,
			input: "3",
			method: "song.getLyrics"
		}, { sng_id: songId });

		const result = lyricsResponse.data?.results;
		if (!result || (!result.LYRICS_SYNC_JSON && !result.LYRICS_TEXT)) {
			debug("Deezer: Lyrics not available for song ID: " + songId);
			return undefined;
		}

		const lines: LyricsLine[] = [];
		let synchronized = false;

		if (result.LYRICS_SYNC_JSON && result.LYRICS_SYNC_JSON.length > 0) {
			synchronized = true;
			result.LYRICS_SYNC_JSON.forEach((item: any) => {
				lines.push({
					text: item.line,
					time: parseInt(item.milliseconds) / 1000
				});
			});
		} else if (result.LYRICS_TEXT) {
			result.LYRICS_TEXT.split("\n").forEach((line: string) => {
				lines.push({ text: line.trim() });
			});
		}

		if (lines.length === 0) return undefined;

		return {
			provider: "Deezer",
			synchronized,
			lines,
			copyright: result.LYRICS_COPYRIGHTS
		};
	} catch (error) {
		debug("Deezer query failed:", error);
		return undefined;
	}
}
