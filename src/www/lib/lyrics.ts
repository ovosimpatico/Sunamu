import lang from "./lang/index.js";
import songdata from "./songdata.js";
import config from "./config.js";
import { animateScroll } from "./util.js";
const container = document.getElementById("lyrics")!;
const copyright = document.getElementById("lyrics-copyright")!;

let isContainerHovered: boolean, animateStatus: { invalidated: boolean; completed: boolean; } | undefined;

export function putLyricsInPlace() {
	// remove all children of container
	container.classList.remove("synchronized");

	while (container.firstChild) container.removeChild(container.lastChild!);

	// remove text from footer
	copyright.textContent = "";

	// loading lyrics
	if (!songdata.lyrics){
		document.documentElement.classList.add("no-lyrics");

		const loading = document.createElement("span");
		loading.classList.add("line");
		loading.textContent = lang.LOADING_LYRICS;
		container.appendChild(loading);
		loading.scrollIntoView({
			inline: "center",
			block: "center",
			behavior: "smooth"
		});
		return;
	}

	// no lyrics
	if (songdata.lyrics.unavailable) {
		document.documentElement.classList.add("no-lyrics");

		const noLyrics = document.createElement("span");
		noLyrics.classList.add("line");
		noLyrics.textContent = lang.NO_LYRICS;
		container.appendChild(noLyrics);
		noLyrics.scrollIntoView({
			inline: "center",
			block: "center",
			behavior: "smooth"
		});
		return;
	}

	// lyrics!
	document.documentElement.classList.remove("no-lyrics");

	// we are good with lyrics so we push them all
	for (let lineIndex = 0; lineIndex < songdata.lyrics.lines!.length; lineIndex++) {
		const line = songdata.lyrics.lines![lineIndex];
		const elem = document.createElement("span");
		elem.classList.add("line");

		if (line.text.length) {
			if (config.karaoke && line.karaoke?.length) {
				for (let verseIndex = 0; verseIndex < line.karaoke.length; verseIndex++) {
					const verse = line.karaoke[verseIndex];

					const duration = Math.max(
						0.1,
						(
							line.karaoke[verseIndex + 1]?.start ||
							(line.duration ? line.time! + line.duration! : undefined) ||
							songdata.lyrics.lines![lineIndex + 1]?.time! ||
							songdata.metadata.length
						) - verse.start
					);

					const span = document.createElement("span");
					span.textContent = verse.text;
					span.style.setProperty("--word-duration", `${duration}s`);

					if (verse.text.trim().length) {
						span.classList.add("word");

						if (
							!document.documentElement.classList.contains("no-clickable-lyrics") &&
							!document.documentElement.classList.contains("non-interactive")
						) {
							span.addEventListener("click", event => {
								event.stopPropagation();
								window.np.setPosition(verse.start);
							});
						}
					}

					elem.appendChild(span);
				}
			} else
				elem.textContent = line.text;

			if (config.translations && line.translation) {
				const translation = document.createElement("span");
				translation.classList.add("translation");
				translation.textContent = line.translation;
				elem.appendChild(translation);
			}

			if (
				!document.documentElement.classList.contains("no-clickable-lyrics") &&
				!document.documentElement.classList.contains("non-interactive") &&
				line.time
			) {
				elem.addEventListener("click", event => {
					event.stopPropagation();
					window.np.setPosition(line.time!);
				});
			}

		} else {
			elem.classList.add("empty");
			const emptyProgress = document.createElement("div");
			emptyProgress.classList.add("empty-progress");
			elem.appendChild(emptyProgress);
		}

		container.appendChild(elem);
	}

	// we put the synchronized flag
	if(songdata.lyrics.synchronized && songdata.reportsPosition)
		container.classList.add("synchronized");

	// we put the copyright where it is supposed to be
	copyright.textContent = lang.LYRICS_COPYRIGHT.replace("%PROVIDER%", songdata.lyrics.provider!);
	if (songdata.lyrics.copyright)
		copyright.textContent += ` • ${songdata.lyrics.copyright}`;
}

export function updateActiveLyrics(elapsed: number) {
	if (!songdata.lyrics?.synchronized)
		return;

	if (!songdata.reportsPosition){
		container.classList.remove("synchronized");
		return;
	}

	container.classList.add("synchronized");

	// we get the active line
	let lineIndex = songdata.lyrics.lines!.length - 1;
	for (let i = -1; i < songdata.lyrics.lines!.length; i++) {
		// @ts-ignore
		if (elapsed < songdata.lyrics.lines[i + 1]?.time) {
			lineIndex = i;
			break;
		}
	}

	// we get the active word
	let wordIndex = -1;
	if (config.karaoke && songdata.lyrics.lines![lineIndex]?.karaoke?.length){
		wordIndex = songdata.lyrics.lines![lineIndex]?.karaoke!.length - 1;
		for (let i = -1; i < songdata.lyrics.lines![lineIndex]?.karaoke!.length; i++) {
			// @ts-ignore
			if (elapsed < songdata.lyrics.lines[lineIndex].karaoke[i + 1]?.start) {
				wordIndex = i;
				break;
			}
		}
	}

	updateLyricsVisual(lineIndex, wordIndex, elapsed);
}

// High-precision lyrics sync using event dispatcher
function updateLyricsVisual(lineIndex: number, wordIndex: number, elapsed: number) {
	// now we iterate through the container to unset previous active stuff
	const wasActiveBefore = container.children[lineIndex]?.classList?.contains("active");

	for (let i = 0; i < container.children.length; i++) {
		const line = container.children[i] as HTMLElement;
		if (i === lineIndex){

			if(config.karaoke){
				for (let i = 0; i < line.children.length; i++) {
					const word = line.children[i] as HTMLElement;
					if(i <= wordIndex){
						if (word.classList?.contains("word"))
							word.classList?.add("active");
					}else{
						if (word.classList?.contains("word"))
							word.classList?.remove("active");
					}
				}
			}

			if(line.classList.contains("empty") && songdata.lyrics?.lines){
				// determine empty progress
				const emptyProgress = [...line.children].find(x => x.classList.contains("empty-progress")) as HTMLElement;

				const percentageToGo = (elapsed - songdata.lyrics.lines[i].time!) / ((songdata.lyrics.lines[i + 1]?.time || songdata.metadata.length) - songdata.lyrics.lines[i].time!);
				emptyProgress.style.setProperty("--waitTime", `${percentageToGo}`);
			}

			line.removeAttribute("distance");
			line.classList?.add("active");
		}else{
			const distance = Math.max(-4, Math.min(i - lineIndex, 4));
			line.setAttribute("distance", `${distance}`);
			line.classList?.remove("active");

			if(config.karaoke){
				for (let i = 0; i < line.children.length; i++) {
					const word = line.children[i] as HTMLElement;
					if(word.classList.contains("word"))
						word.classList?.remove("active");
				}
			}
		}
	}

	// now we animate the active into view
	if (!wasActiveBefore && !isContainerHovered) {
		// invalidate previous animation
		if(animateStatus)
			animateStatus.invalidated = true;

		// call new animation
		animateStatus = animateScroll(container.children[lineIndex] as HTMLElement);
	}
}

export function reCenter() {
	if(isContainerHovered) return;

	if (container.children.length === 1) {
		// assuming we only have one child so it is the no lyrics child
		document.getElementById("metadata")!.children[0].scrollIntoView({
			inline: "center",
			block: "center",
			behavior: "auto"
		});
	} else {
		// we do have lyrics so we scroll to the active one
		container.getElementsByClassName("line active")[0]?.scrollIntoView({
			inline: "center",
			block: "center",
			behavior: "auto"
		});
	}
}

container.addEventListener("mouseenter", () => isContainerHovered = true);
container.addEventListener("mouseleave", () => {
	isContainerHovered = false;
	reCenter();
});

window.np.registerLyricsCallback!(() => {
	putLyricsInPlace();
});
