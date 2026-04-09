import { basename, resolve } from "path";
import { inspect } from "util";
import { debugMode } from "./appStatus";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "fs";
import { getAppData } from "./util";

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
	FATAL = 4
}

const LevelNames = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"];
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

class Logger {
	private logDir: string;
	private logFile: string;
	private oldLogFile: string;

	constructor() {
		this.logDir = resolve(getAppData(), "sunamu", "logs");
		this.logFile = resolve(this.logDir, "main.log");
		this.oldLogFile = resolve(this.logDir, "main.old.log");
		
		try {
			if (!existsSync(this.logDir)) {
				mkdirSync(this.logDir, { recursive: true });
			}
		} catch (e) {
			console.error("Failed to create log directory:", e);
		}
	}

	private rotateIfNeeded() {
		try {
			if (existsSync(this.logFile)) {
				const stats = statSync(this.logFile);
				if (stats.size > MAX_LOG_SIZE) {
					renameSync(this.logFile, this.oldLogFile);
				}
			}
		} catch (e) {
			console.error("Log rotation failed:", e);
		}
	}

	private getCaller(shift: number = 0) {
		const _handler = Error.prepareStackTrace;
		Error.prepareStackTrace = (_a, b) => b;
		const resultHolder: any = {};
		Error.captureStackTrace(resultHolder);
		// eslint-disable-next-line no-undef
		const stack: NodeJS.CallSite[] = resultHolder.stack;
		Error.prepareStackTrace = _handler;

		// 0 is getCaller, 1 is log, 2 is the actual caller
		const callSite = stack[shift + 2];
		if (!callSite) return "unknown";
		
		const file = callSite.getFileName();
		const line = callSite.getLineNumber();
		return `${file ? basename(file) : "nofile"}:${line}`;
	}

	public log(level: LogLevel, ...args: any[]) {
		if (level === LogLevel.DEBUG && !debugMode) return;

		const timestamp = new Date().toISOString();
		const levelName = LevelNames[level];
		const caller = this.getCaller(1);
		
		const formattedArgs = args.map(arg => {
			if (typeof arg === "string") return arg;
			return inspect(arg, { colors: false, depth: 3 });
		});

		const message = formattedArgs.join(" ");
		const logLine = `[${timestamp}] [${levelName}] [${caller}] ${message}`;

		// Console output (with colors)
		const colorCode = level >= LogLevel.ERROR ? "\x1b[31m" : (level === LogLevel.WARN ? "\x1b[33m" : "");
		const resetCode = "\x1b[0m";
		console.log(`${colorCode}${logLine}${resetCode}`);

		// File output
		try {
			this.rotateIfNeeded();
			appendFileSync(this.logFile, logLine + "\n");
		} catch (e) {
			console.error("Failed to write to log file:", e);
		}
	}
}

const logger = new Logger();

export const debug = (...args: any[]) => logger.log(LogLevel.DEBUG, ...args);
export const info = (...args: any[]) => logger.log(LogLevel.INFO, ...args);
export const warn = (...args: any[]) => logger.log(LogLevel.WARN, ...args);
export const error = (...args: any[]) => logger.log(LogLevel.ERROR, ...args);
export const fatal = (...args: any[]) => logger.log(LogLevel.FATAL, ...args);

// Legacy support for logToDebug
export function logToDebug(...args: any[]) {
	if (args.length && typeof args[0] === "number") args.shift();
	logger.log(LogLevel.DEBUG, ...args);
}