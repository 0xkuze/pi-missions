export interface StreamLike {
	on(event: string, handler: (data: Buffer) => void): unknown;
}

export interface ProcLike {
	stdout: StreamLike | null;
	stderr: StreamLike | null;
	kill?: (signal: string) => void;
	killed?: boolean;
	pid?: number;
	on(event: string, handler: (...args: unknown[]) => void): unknown;
}

export type SpawnFn = (command: string, args: string[], options: Record<string, unknown>) => ProcLike;
