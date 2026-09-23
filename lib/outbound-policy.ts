/** Neither a webhook nor an LLM endpoint may target Google Forms. No redirects are followed. */
export function isGoogleFormsHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return ["docs.google.com", "forms.google.com", "forms.gle"].some((root) => host === root || host.endsWith(`.${root}`));
}
