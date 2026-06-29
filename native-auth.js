/*
 * native-auth.js — loaded only inside the Capacitor (Android) app.
 *
 * Goal: replace the browser's short-lived Google Identity Services token flow with
 * a NATIVE OAuth flow that returns a refresh token, so Drive access renews silently
 * forever and the user authorises only once. On the plain website this file is not
 * loaded, so nothing changes there.
 *
 * The web app exposes two hooks we override here:
 *   window.__nativeGetToken()   -> Promise<string accessToken>   (silent if possible)
 *   window.__nativeIsAvailable  -> boolean
 * The web app's existing Drive code calls these when present instead of GIS.
 */
(function () {
  const Capacitor = window.Capacitor;
  if (!Capacitor || !Capacitor.isNativePlatform || !Capacitor.isNativePlatform()) {
    return; // running in a normal browser — leave the GIS flow alone
  }

  const OAuth2Client = Capacitor.Plugins.GenericOAuth2;
  const Preferences = Capacitor.Plugins.Preferences;

  // Android OAuth client ID (added in Google Cloud Console, type "Android" OR a
  // "Web"/"Desktop" client used as an installed app). Filled in by the build.
  const ANDROID_CLIENT_ID = window.__ANDROID_OAUTH_CLIENT_ID || '';
  const SCOPES = 'https://www.googleapis.com/auth/drive.file';

  const TOKEN_KEY = 'mtg_native_tokens';

  async function loadTokens() {
    try { const r = await Preferences.get({ key: TOKEN_KEY }); return r.value ? JSON.parse(r.value) : null; }
    catch { return null; }
  }
  async function saveTokens(t) {
    try { await Preferences.set({ key: TOKEN_KEY, value: JSON.stringify(t) }); } catch {}
  }

  // Exchange a refresh token for a fresh access token (silent, no UI).
  async function refreshAccessToken(refreshToken) {
    const body = new URLSearchParams({
      client_id: ANDROID_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!resp.ok) throw new Error('refresh failed: ' + resp.status);
    return resp.json(); // { access_token, expires_in, ... }
  }

  // Full interactive authorisation (first run / when refresh token is missing).
  async function interactiveAuth() {
    const result = await OAuth2Client.authenticate({
      authorizationBaseUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      accessTokenEndpoint: 'https://oauth2.googleapis.com/token',
      scope: SCOPES,
      // access_type=offline + prompt=consent => Google returns a refresh token.
      additionalParameters: { access_type: 'offline', prompt: 'consent' },
      android: {
        appId: ANDROID_CLIENT_ID,
        responseType: 'code', // auth-code flow → refresh token
        redirectUrl: ANDROID_CLIENT_ID.endsWith('.apps.googleusercontent.com')
          ? 'com.googleusercontent.apps.' + ANDROID_CLIENT_ID.replace('.apps.googleusercontent.com','') + ':/'
          : undefined
      }
    });
    // generic-oauth2 returns the token response under access_token_response
    const r = result.access_token_response || result;
    const tokens = {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      obtained_at: Date.now(),
      expires_in: r.expires_in || 3600
    };
    await saveTokens(tokens);
    return tokens;
  }

  // Public: get a valid access token, silently if we already have a refresh token.
  window.__nativeGetToken = async function () {
    let tokens = await loadTokens();
    const fresh = tokens && (Date.now() - tokens.obtained_at) < ((tokens.expires_in - 120) * 1000);
    if (tokens && fresh) return tokens.access_token;
    if (tokens && tokens.refresh_token) {
      try {
        const r = await refreshAccessToken(tokens.refresh_token);
        tokens.access_token = r.access_token;
        tokens.obtained_at = Date.now();
        tokens.expires_in = r.expires_in || 3600;
        await saveTokens(tokens);
        return tokens.access_token;
      } catch (e) {
        // refresh token revoked/expired — fall through to interactive
      }
    }
    tokens = await interactiveAuth();
    return tokens.access_token;
  };

  window.__nativeSignOut = async function () {
    try { await Preferences.remove({ key: TOKEN_KEY }); } catch {}
  };

  window.__nativeIsAvailable = true;
  console.log('[native-auth] ready (Android refresh-token flow active)');
})();
