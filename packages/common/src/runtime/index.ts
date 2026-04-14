/**
 * Returns true when the current process is running from a `bun build --compile`
 * binary. Bun injects a virtual `/$bunfs/...` path as `argv[1]` on every launch
 * of a compiled executable; dev runs (`bun src/cli.ts ...`) never see that.
 *
 * Use this to gate behavior that differs between the packaged binary and
 * developer workflows (e.g. auto-restart vs. "please restart manually").
 */
export function isCompiledBinary(): boolean {
	return process.argv[1]?.startsWith("/$bunfs/") ?? false;
}
