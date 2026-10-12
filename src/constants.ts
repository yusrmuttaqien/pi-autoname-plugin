// constants.ts — shared default values (single source of truth).
//
// These are the effective defaults for the two optional length knobs. They
// live here (not in naming.ts) so config.ts can write them into the
// auto-generated config file without importing the whole naming module.

/** Default max chars for every terminal/frame window name (herdr pane/tab,
 * tmux window, zellij pane/tab). Overridden by `windowNameMaxLength`. */
export const DEFAULT_MAX_WINDOW_NAME_CHARS = 30;

/** Default max chars for the Pi session name. Overridden by
 * `sessionNameMaxLength`. */
export const DEFAULT_MAX_SESSION_NAME_CHARS = 200;
