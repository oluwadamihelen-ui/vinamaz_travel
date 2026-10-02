export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Stable machine key (snake_case) from a human label. */
export function keyify(input: string): string {
  return slugify(input).replace(/-/g, "_").slice(0, 60);
}
