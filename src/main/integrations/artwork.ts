import axios from "axios";
import { Metadata } from "../../types";
import { get as getConfig } from "../config";
import { getBearerToken } from "./applemusic_auth";
import { info } from "../logger";

export async function queryArtwork(metadata: Metadata): Promise<string | undefined> {
	info("Querying improved artwork for: " + metadata.artist + " - " + metadata.title);
	
	// 1. Try Apple Music
	const amArt = await queryAppleMusicArtwork(metadata);
	if (amArt) {
		info("Artwork found on Apple Music");
		return amArt;
	}

	// 2. Try Deezer
	const dzArt = await queryDeezerArtwork(metadata);
	if (dzArt) {
		info("Artwork found on Deezer");
		return dzArt;
	}

	// 3. Try iTunes Search API
	const itArt = await queryiTunesArtwork(metadata);
	if (itArt) {
		info("Artwork found on iTunes");
		return itArt;
	}

	info("No improved artwork found");
	return undefined;
}

const artworkCache = new Map<string, string>();

async function queryAppleMusicArtwork(metadata: Metadata): Promise<string | undefined> {
	const cacheKey = `${metadata.artist}-${metadata.title}`;
	if (artworkCache.has(cacheKey)) {
		info("Using cached animated artwork for " + cacheKey);
		return artworkCache.get(cacheKey);
	}

	const bearer = await getBearerToken();
	if (!bearer) return undefined;

	const storefront = getConfig("amStorefront") || "us";
	try {
		const term = `${metadata.artist} ${metadata.title}`;
		const searchResponse = await axios.get(`https://amp-api.music.apple.com/v1/catalog/${storefront}/search`, {
			params: { term, types: "songs,albums", limit: 3 },
			headers: { 
				Authorization: `Bearer ${bearer}`,
				Origin: "https://music.apple.com",
				Referer: "https://music.apple.com/"
			}
		});

		const album = searchResponse.data.results.albums?.data?.[0];
		const song = searchResponse.data.results.songs?.data?.[0];
		
		let videoUrl: string | undefined;

		// 1. Check search result attributes first (rarely present in skinny view but checked for perf)
		const checkVideo = (obj: any) => {
			if (obj?.attributes?.editorialVideo?.motionDetailSquare?.video) return obj.attributes.editorialVideo.motionDetailSquare.video;
			if (obj?.attributes?.editorialVideos?.[0]?.motionDetailSquare?.video) return obj.attributes.editorialVideos[0].motionDetailSquare.video;
			return undefined;
		};

		videoUrl = checkVideo(album) || checkVideo(song);

		// 2. If not found, try deep lookup by ID
		if (!videoUrl && album?.id) {
			try {
				const albumRes = await axios.get(`https://amp-api.music.apple.com/v1/catalog/${storefront}/albums/${album.id}`, {
					params: { include: "editorial-video,editorial-videos" },
					headers: { 
						Authorization: `Bearer ${bearer}`,
						Origin: "https://music.apple.com",
						Referer: "https://music.apple.com/"
					}
				});
				const fullAlbum = albumRes.data.data?.[0];
				videoUrl = checkVideo(fullAlbum);
			} catch (e) {}
		}

		// 3. Hybrid Scraper Fallback: Fetch public page and grep for m3u8
		if (!videoUrl && album?.attributes?.url) {
			try {
				const pageRes = await axios.get(album.attributes.url, {
					headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" }
				});
				// Regex to find motion artwork m3u8 manifests
				const m3u8Match = /https:\/\/[^\s\"]+\.m3u8/.exec(pageRes.data);
				if (m3u8Match) {
					videoUrl = m3u8Match[0];
				}
			} catch (e) {}
		}

		if (videoUrl) {
			const finalUrl = videoUrl.replace(/\{[wh]\}/g, "1080");
			info("FOUND ANIMATED ARTWORK: " + finalUrl);
			artworkCache.set(cacheKey, finalUrl);
			return finalUrl;
		}

		// 4. Final Fallback: Static Artwork
		if (song?.attributes?.artwork?.url) {
			return song.attributes.artwork.url.replace("{w}", "3000").replace("{h}", "3000");
		}
	} catch (e) {
		// Silent fail
	}
	return undefined;
}

async function queryDeezerArtwork(metadata: Metadata): Promise<string | undefined> {
	try {
		const searchResponse = await axios.get("https://api.deezer.com/search", {
			params: { q: `${metadata.artist} ${metadata.title}`, limit: 1 }
		});

		const track = searchResponse.data.data?.[0];
		if (track?.album?.cover_xl || track?.album?.cover_big) {
			return track.album.cover_xl || track.album.cover_big;
		}
	} catch (e) {
		// Silent fail
	}
	return undefined;
}

async function queryiTunesArtwork(metadata: Metadata): Promise<string | undefined> {
	try {
		const response = await axios.get("https://itunes.apple.com/search", {
			params: { term: `${metadata.artist} ${metadata.title}`, entity: "song", limit: 1 }
		});

		const result = response.data.results?.[0];
		if (result?.artworkUrl100) {
			return result.artworkUrl100.replace("100x100bb", "3000x3000bb");
		}
	} catch (e) {
		// Silent fail
	}
	return undefined;
}
