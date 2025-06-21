import path from "path";
import getPlayer, { Player } from "./player";
import configEmitter, { get as getConfig, getAll as getAllConfig } from "./config";
import { widgetMode, debugMode, useElectron } from "./appStatus";

import { Server, Socket } from "socket.io";
import { createServer } from "http";
import { Server as StaticServer } from "node-static";
import playbackStatus, { setCustomLyrics, songdata } from "./playbackStatus";
import { getThemeLocation, getThemesDirectory } from "./themes";

import { debug } from ".";
import { getAllLyrics } from "./integrations/lyrics";

let player: Player;

const file = new StaticServer(path.resolve(__dirname, "..", "www"), { indexFile: "index.htm", cache: 0 });
const themes = new StaticServer(getThemesDirectory(), {	cache: 0 });
const server = createServer((req, res) => {
	if(req.url!.startsWith("/themes/")){
		req.url = req.url!.replace("/themes/", "/");
		themes.serve(req, res);
		return;
	}
	file.serve(req, res);
});

export const io = new Server(server);

function registerIpc(socket: Socket) {
	socket.on("previous", () => player.Previous());
	socket.on("playPause", () => player.PlayPause());
	socket.on("next", () => player.Next());

	socket.on("shuffle", () => player.Shuffle());
	socket.on("repeat", () => player.Repeat());

	socket.on("seek", (perc) => player.SeekPercentage(perc));
	socket.on("getPosition", async (callback) => callback(await player.GetPosition()));
	socket.on("setPosition", (position) => player.SetPosition(position));

	socket.on("getSongData", (callback) => callback(songdata));
	socket.on("getConfig", (callback) => callback(getAllConfig()));

	socket.on("searchAllLyrics", async (metadata, callback) => callback(await getAllLyrics(metadata)));
	socket.on("chooseLyrics", async (lyrics) => await setCustomLyrics(lyrics));


	socket.on("isWidgetMode", (callback) => callback(widgetMode));
	socket.on("isDebugMode", (callback) => callback(debugMode));
	socket.on("isElectronRunning", (callback) => callback(useElectron));

	socket.on("getThemeLocationFor", async (theme, callback) => {
		const themeLocation = await getThemeLocation(theme);
		if(!themeLocation)
			return callback();

		callback("/themes/" + path.relative(getThemesDirectory(), themeLocation).split("\\").join("/"));
	});
}

function registerWindowCallbacks(socket: Socket) {
	const positionCallback = async (position, reportsPosition) => { socket.emit("position", position, reportsPosition); };
	const songDataCallback = async (songdata, metadataChanged) => { socket.emit("update", songdata, metadataChanged); };
	const lyricsUpdateCallback = async () => { socket.emit("refreshLyrics"); };
	const configChangedCallback = async () => { socket.emit("configChanged"); };

	// High-precision event callbacks
	const lyricsyncCallback = async (event) => { socket.emit("lyrics.sync", event); };
	const precisePositionCallback = async (position, isPlaying) => { socket.emit("position.precise", position, isPlaying); };
	const playbackStateCallback = async (event) => { socket.emit("playback.state", event); };

	playbackStatus.on("position", positionCallback);
	playbackStatus.on("songdata", songDataCallback);
	playbackStatus.on("lyrics", lyricsUpdateCallback);

	// Register high-precision event listeners
	playbackStatus.on("lyrics.sync", lyricsyncCallback);
	playbackStatus.on("position.precise", precisePositionCallback);
	playbackStatus.on("playback.state", playbackStateCallback);

	configEmitter.on("configChanged", configChangedCallback);

	// Handle real-time lyrics compensation adjustment
	socket.on("setLyricsCompensation", (compensationMs: number) => {
		// Import eventDispatcher here to avoid circular dependency
		const { eventDispatcher } = require("./eventDispatcher");
		eventDispatcher.setCompensation(compensationMs);
	});

	socket.once("disconnect", () => {
		socket.removeAllListeners();
		playbackStatus.off("position", positionCallback);
		playbackStatus.off("songdata", songDataCallback);
		playbackStatus.off("lyrics", lyricsUpdateCallback);
		playbackStatus.off("lyrics.sync", lyricsyncCallback);
		playbackStatus.off("position.precise", precisePositionCallback);
		playbackStatus.off("playback.state", playbackStateCallback);

		configEmitter.off("configChanged", configChangedCallback);
	});
}

export default async function webserverMain(){
	player = await getPlayer();

	server.listen(getConfig("webserverPort"), () => debug(`WebServer listening on port ${getConfig("webserverPort")}`));

	io.on("connection", socket => {
		registerIpc(socket);
		registerWindowCallbacks(socket);
	});
}
