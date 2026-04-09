import axios from "axios";
import { debug } from "..";

let deezerToken: string | undefined;
let cookies: string[] = [];

const DEEZER_API_URL = "https://www.deezer.com/ajax/gw-light.php";
const DEEZER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

function getHeaders(): Record<string, string> {
	const headers: Record<string, string> = { "User-Agent": DEEZER_UA };
	if (cookies.length > 0) {
		headers["Cookie"] = cookies.join("; ");
	}
	return headers;
}

function updateCookies(setCookies?: string[]): void {
	if (!setCookies) return;
	setCookies.forEach(c => {
		const cookie = c.split(";")[0];
		const name = cookie.split("=")[0];
		const index = cookies.findIndex(existing => existing.startsWith(name + "="));
		if (index !== -1) {
			cookies[index] = cookie;
		} else {
			cookies.push(cookie);
		}
	});
}

export async function deezerPost(params: Record<string, string>, data: any = {}): Promise<any> {
	const response = await axios.post(DEEZER_API_URL, data, {
		params,
		headers: getHeaders()
	});
	updateCookies(response.headers["set-cookie"]);
	return response;
}

export async function getDeezerToken(forceRefresh = false): Promise<string | undefined> {
	if (deezerToken && !forceRefresh) return deezerToken;

	try {
		debug("Fetching Deezer Anonymous Token...");
		const response = await deezerPost({
			api_version: "1.0",
			api_token: "null",
			input: "3",
			method: "deezer.getUserData"
		});

		if (response.data?.results?.checkForm) {
			deezerToken = response.data.results.checkForm;
			debug("Successfully fetched Deezer Anonymous Token");
			return deezerToken;
		}

		debug("Could not find Deezer checkForm token in response");
		return undefined;
	} catch (error) {
		debug("Error fetching Deezer Anonymous Token:", error);
		return undefined;
	}
}
