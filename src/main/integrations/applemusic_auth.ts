import axios from "axios";
import { debug } from "..";

let bearerToken: string | undefined;
let bearerTokenPromise: Promise<string | undefined> | undefined;

export async function getBearerToken(forceRefresh = false): Promise<string | undefined> {
	if (bearerToken && !forceRefresh) return bearerToken;
	if (bearerTokenPromise && !forceRefresh) return bearerTokenPromise;

	bearerTokenPromise = (async () => {
		try {
			debug("Scraping Apple Music Bearer Token...");
			const mainPage = await axios.get("https://music.apple.com/", {
				headers: {
					"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
				}
			});
			const jsBundleMatch = /src="([^"]*\/assets\/index(?:\.[\w-]+)?~[\w-]+\.js)"/.exec(mainPage.data);
			if (!jsBundleMatch) {
				debug("Could not find Apple Music JS bundle path");
				return undefined;
			}

			const jsBundleUrl = jsBundleMatch[1].startsWith("http") ? jsBundleMatch[1] : `https://music.apple.com${jsBundleMatch[1]}`;
			const jsContent = await axios.get(jsBundleUrl);
			const tokenMatch = /"(eyJhYmVhZGVy[\w\.-]+)"/.exec(jsContent.data) || /"(eyJh[\w\.-]+)"/.exec(jsContent.data);
			if (!tokenMatch) {
				debug("Could not find Apple Music Bearer Token in JS bundle");
				return undefined;
			}

			bearerToken = tokenMatch[1];
			debug("Successfully scraped Apple Music Bearer Token");
			return bearerToken;
		} catch (error) {
			debug("Error scraping Apple Music Bearer Token:", error);
			return undefined;
		} finally {
			bearerTokenPromise = undefined;
		}
	})();

	return bearerTokenPromise;
}
