import axios from "axios";
import { Lyrics, Metadata, LyricsLine } from "../../types";

export async function query(metadata: Metadata): Promise<Lyrics | undefined> {
	try {
		const url = "https://lrclib.net/api/get";
		const response = await axios.get(url, {
			params: {
				artist_name: metadata.artist,
				track_name: metadata.title,
				album_name: metadata.album,
				duration: Math.round(metadata.length)
			}
		});

		const data = response.data;
		if (!data || (!data.syncedLyrics && !data.plainLyrics)) {
			return undefined;
		}

		const lines: LyricsLine[] = [];
		let synchronized = false;

		if (data.syncedLyrics) {
			synchronized = true;
			const lrcLines = data.syncedLyrics.split("\n");
			for (const line of lrcLines) {
				const match = /^\[(\d+):(\d+\.\d+)\](.*)/.exec(line);
				if (match) {
					const minutes = parseInt(match[1]);
					const seconds = parseFloat(match[2]);
					lines.push({
						text: match[3].trim(),
						time: minutes * 60 + seconds
					});
				}
			}
		} else if (data.plainLyrics) {
			data.plainLyrics.split("\n").forEach((line: string) => {
				lines.push({ text: line.trim() });
			});
		}

		if (lines.length === 0) return undefined;

		return {
			provider: "LRCLIB",
			synchronized,
			lines
		};
	} catch (error) {
		// LRCLIB 404s if nothing is found, which is fine
		return undefined;
	}
}
