/** npm/PowerShell can consume --dry-run as an npm option before forwarding args. */
export function isDryRun(args: readonly string[], env: Record<string, string | undefined> = process.env): boolean {
  return args.includes("--dry-run") || /^(true|1)$/i.test(env.npm_config_dry_run ?? "");
}
