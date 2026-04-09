import axios from "axios";
import { JSDOM } from "jsdom";
import { Lyrics, Metadata, LyricsLine, LyricsKaraokeVerse } from "../../types";
import { get as getConfig } from "../config";
import { getBearerToken } from "../integrations/applemusic_auth";
import { debug } from "..";

export async function query(metadata: Metadata): Promise<Lyrics | undefined> {
	const bearer = await getBearerToken();
	if (!bearer) return undefined;

	const storefront = getConfig("amStorefront") || "us";
	const userToken = getConfig("amMediaUserToken");

	try {
		// 1. Search for the song
		const searchUrl = `https://amp-api.music.apple.com/v1/catalog/${storefront}/search`;
		const term = normalizeSearchTerm(`${metadata.artist} ${metadata.title}`);
		
		const searchResponse = await axios.get(searchUrl, {
			params: {
				term,
				types: "songs",
				limit: 10
			},
			headers: {
				Authorization: `Bearer ${bearer}`,
				Origin: "https://music.apple.com",
				Referer: "https://music.apple.com/"
			}
		});

		const song = searchResponse.data.results.songs?.data?.[0];
		if (!song) {
			debug("Apple Music: Song not found for term: " + term);
			return undefined;
		}

		const songId = song.id;

		// 2. Fetch lyrics
		// Try syllable-lyrics first, then lyrics
		let lyricsData: any;
		const headers: any = { 
			Authorization: `Bearer ${bearer}`,
			Origin: "https://music.apple.com",
			Referer: "https://music.apple.com/"
		};
		if (userToken) headers["Cookie"] = `media-user-token=${userToken}`;

		try {
			const lyricsUrl = `https://amp-api.music.apple.com/v1/catalog/${storefront}/songs/${songId}/syllable-lyrics`;
			const resp = await axios.get(lyricsUrl, { headers });
			lyricsData = resp.data.data?.[0]?.attributes;
		} catch (e) {
			try {
				const lyricsUrl = `https://amp-api.music.apple.com/v1/catalog/${storefront}/songs/${songId}/lyrics`;
				const resp = await axios.get(lyricsUrl, { headers });
				lyricsData = resp.data.data?.[0]?.attributes;
			} catch (e2) {
				debug("Apple Music: Lyrics not available for song ID: " + songId);
				return undefined;
			}
		}

		if (!lyricsData?.ttml) return undefined;

		// 3. Parse TTML
		const lyrics = parseTTML(lyricsData.ttml);
		if (!lyrics) return undefined;

		return {
			provider: "Apple Music",
			synchronized: lyrics.synchronized,
			lines: lyrics.lines
		};
	} catch (error) {
		debug("Apple Music query failed:", error);
		return undefined;
	}
}

function normalizeSearchTerm(term: string): string {
	return term
		.toLowerCase()
		.replace(/\(feat\..*?\)/g, "")
		.replace(/\[.*?\]/g, "")
		.replace(/\(.*?\)/g, "")
		.trim();
}

function parseTime(time: string): number {
	const parts = time.split(":").map(parseFloat);
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	return parts[0] || 0;
}

function parseTTML(ttml: string): { synchronized: boolean, lines: LyricsLine[] } | undefined {
	const dom = new JSDOM(ttml, { contentType: "text/xml" });
	const doc = dom.window.document;
	const tt = doc.querySelector("tt");
	if (!tt) return undefined;

	// Use wildcard for namespaced attribute
	const timing = tt.getAttribute("itunes:timing") || tt.getAttribute("timing") || "None";
	const synchronized = timing !== "None";

	const lines: LyricsLine[] = [];
	const pElements = doc.querySelectorAll("p");

	pElements.forEach(p => {
		const begin = p.getAttribute("begin");
		if (!begin && synchronized) return;

		const line: LyricsLine = {
			text: "",
			time: begin ? parseTime(begin) : undefined
		};

		const spans = p.querySelectorAll("span");
		if (spans.length > 0) {
			const karaoke: LyricsKaraokeVerse[] = [];
			spans.forEach(span => {
				const sBegin = span.getAttribute("begin");
				const start = sBegin ? parseTime(sBegin) : line.time;
				const text = span.textContent || "";
				if (text.trim() || karaoke.length > 0) {
					karaoke.push({ text, start: start || 0 });
				}
			});
			line.karaoke = karaoke;
			line.text = Array.from(spans).map(s => s.textContent).join("");
		} else {
			line.text = (p.textContent || "").trim();
		}

		if (line.text || line.karaoke) {
			lines.push(line);
		}
	});

	if (lines.length === 0) return undefined;

	return { synchronized, lines };
}
