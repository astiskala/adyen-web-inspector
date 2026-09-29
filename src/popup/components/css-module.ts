/** A CSS module's class names; keys the stylesheet does not define are undefined. */
type CssModuleClasses = Readonly<Record<string, string | undefined>>;

/**
 * Returns a class-name lookup for a CSS module, giving an empty class for
 * names the stylesheet does not define.
 */
export function cssModule(styles: CssModuleClasses): (key: string) => string {
  return (key) => styles[key] ?? '';
}
