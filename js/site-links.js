// Links back to wepeka.com. One Wepeka account covers both products: the
// site mints a Firebase custom token for the signed-in Community member and
// hands it to this app at `#/sso?t=<token>` (see js/main.js). The token
// rides in the hash fragment on purpose — fragments are never sent to a
// server, so it can't end up in an access log or a Referer header.
export const WEPEKA_SITE_URL = "https://www.wepeka.com";

// The site route that checks the Wepeka session and sends the user back
// here already signed in; logged-out visitors get the sign-up/login screen
// there first.
export const WEPEKA_CONNECT_URL = `${WEPEKA_SITE_URL}/brandlab/connect`;

// Wepeka's Instagram handle (no @) — printed on the shareable campaign
// story card and put in the caption that gets copied alongside it.
export const WEPEKA_IG_HANDLE = "wepeka";
