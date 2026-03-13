/** Web app utilities — can import from @clawno/shared when needed */

/** Mask an API key for display: sk-abcd...1234 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}
