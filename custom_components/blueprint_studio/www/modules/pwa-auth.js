/**
 * PWA Authentication Module
 * Handles authentication for standalone PWA mode using HA OAuth2 flow
 */

import { t, initTranslations } from './translations.js';

export class PWAAuth {
  constructor() {
    this.accessTokenKey = 'blueprint_studio_access_token';
    this.refreshTokenKey = 'blueprint_studio_refresh_token';
    this.expiresAtKey = 'blueprint_studio_token_expires_at';
    this.clientId = window.location.origin + '/';
    this.redirectUri = window.location.origin + '/blueprint_studio/?auth_callback=1';
    this._refreshPromise = null;
  }

  /**
   * Check if running in standalone PWA mode
   */
  isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone ||
           document.referrer.includes('android-app://');
  }

  /**
   * Check if user is authenticated (has a refresh token)
   */
  isAuthenticated() {
    return !!localStorage.getItem(this.refreshTokenKey);
  }

  /**
   * Get a valid access token, refreshing if needed
   */
  async getToken() {
    const accessToken = localStorage.getItem(this.accessTokenKey);
    const expiresAt = parseInt(localStorage.getItem(this.expiresAtKey) || '0', 10);

    // If token is valid and not within 30s of expiry, return it
    if (accessToken && Date.now() < (expiresAt - 30000)) {
      return accessToken;
    }

    // Need to refresh
    const refreshToken = localStorage.getItem(this.refreshTokenKey);
    if (!refreshToken) {
      return null;
    }

    return await this.refreshAccessToken();
  }

  /**
   * Get authorization header for API requests
   */
  async getAuthHeader() {
    const token = await this.getToken();
    if (token) {
      return { 'Authorization': `Bearer ${token}` };
    }
    return {};
  }

  /**
   * Redirect to HA OAuth2 login page
   */
  loginWithHA() {
    const state = this._generateRandomState();
    sessionStorage.setItem('blueprint_studio_oauth_state', state);

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      state: state
    });

    window.location.href = `/auth/authorize?${params.toString()}`;
  }

  /**
   * Handle OAuth callback — exchange auth code for tokens
   */
  async _handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const storedState = sessionStorage.getItem('blueprint_studio_oauth_state');

    if (!code || !state) {
      return false;
    }

    // Verify state matches to prevent CSRF
    if (state !== storedState) {
      console.error('[PWA Auth] OAuth state mismatch');
      sessionStorage.removeItem('blueprint_studio_oauth_state');
      return false;
    }

    sessionStorage.removeItem('blueprint_studio_oauth_state');

    try {
      const response = await fetch('/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          client_id: this.clientId
        })
      });

      if (!response.ok) {
        console.error('[PWA Auth] Token exchange failed:', response.status);
        return false;
      }

      const data = await response.json();
      this._storeTokens(data);

      // Clean the URL — remove auth_callback params
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);

      return true;
    } catch (err) {
      console.error('[PWA Auth] Token exchange error:', err);
      return false;
    }
  }

  /**
   * Refresh the access token using the stored refresh token
   */
  async refreshAccessToken() {
    // Deduplicate concurrent refresh calls
    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    this._refreshPromise = this._doRefresh();
    try {
      return await this._refreshPromise;
    } finally {
      this._refreshPromise = null;
    }
  }

  async _doRefresh() {
    const refreshToken = localStorage.getItem(this.refreshTokenKey);
    if (!refreshToken) {
      return null;
    }

    try {
      const response = await fetch('/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.clientId
        })
      });

      if (!response.ok) {
        console.error('[PWA Auth] Token refresh failed:', response.status);
        // Refresh token is invalid — clear everything
        this._clearTokens();
        return null;
      }

      const data = await response.json();
      this._storeTokens(data);
      return data.access_token;
    } catch (err) {
      console.error('[PWA Auth] Token refresh error:', err);
      return null;
    }
  }

  /**
   * Try to get a working auth token from HA's iframe connection.
   * Returns the token string if successful, null otherwise.
   */
  async _tryHassConnectionAuth() {
    try {
      if (!window.parent || window.parent === window || !window.parent.hassConnection) {
        return null;
      }
      const conn = await window.parent.hassConnection;
      if (conn && conn.auth) {
        if (conn.auth.expired) {
          await conn.auth.refreshAccessToken();
        }
        const token = conn.auth.accessToken;
        if (token) {
          // Verify the token actually works
          const response = await fetch('/api/blueprint_studio?action=get_version', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (response.ok) {
            return token;
          }
        }
      }
    } catch (e) {
      // Cross-origin access blocked, connection failed, or token invalid
    }
    return null;
  }

  /**
   * Initialize authentication for PWA
   */
  async initialize() {
    // Check if this is an OAuth callback first (before anything else)
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth_callback') === '1') {
      const success = await this._handleCallback();
      if (success) {
        return true;
      }
      return await this._showLoginDialog();
    }

    // Try HA iframe auth (when loaded inside HA sidebar)
    const hassToken = await this._tryHassConnectionAuth();
    if (hassToken) {
      return true;
    }

    // Try to use existing OAuth session (refresh token)
    if (this.isAuthenticated()) {
      const token = await this.getToken();
      if (token) {
        try {
          const response = await fetch('/api/blueprint_studio?action=get_version', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (response.ok) {
            return true;
          }
        } catch (err) {
          // Token verification failed
        }
      }
      this._clearTokens();
    }

    // No valid session — show login dialog
    return await this._showLoginDialog();
  }

  /**
   * Show the OAuth login dialog
   */
  async _showLoginDialog() {
    // Ensure translations are loaded before rendering the dialog
    await initTranslations(navigator.language?.split('-')[0] || 'en');

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;

      const dialog = document.createElement('div');
      dialog.style.cssText = `
        background: #2c2c2c;
        color: #fff;
        padding: 30px;
        border-radius: 12px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        text-align: center;
      `;

      dialog.innerHTML = `
        <h2 style="margin: 0 0 16px 0; font-size: 24px;">${t("auth.title")}</h2>
        <p style="margin: 0 0 24px 0; color: #aaa; line-height: 1.5;">
          ${t("auth.message")}
        </p>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button
            id="cancel-btn"
            style="
              padding: 12px 24px;
              background: #444;
              border: none;
              border-radius: 6px;
              color: #fff;
              cursor: pointer;
              font-size: 14px;
            "
          >${t("modal.cancel")}</button>
          <button
            id="login-btn"
            style="
              padding: 12px 24px;
              background: #0e639c;
              border: none;
              border-radius: 6px;
              color: #fff;
              cursor: pointer;
              font-size: 14px;
              font-weight: 600;
            "
          >${t("auth.login_button")}</button>
        </div>
      `;

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const loginBtn = dialog.querySelector('#login-btn');
      const cancelBtn = dialog.querySelector('#cancel-btn');

      loginBtn.addEventListener('click', () => {
        document.body.removeChild(overlay);
        this.loginWithHA();
        // Don't resolve — page will redirect
      });

      cancelBtn.addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(false);
      });
    });
  }

  /**
   * Logout — revoke refresh token and clear stored tokens
   */
  async logout() {
    const refreshToken = localStorage.getItem(this.refreshTokenKey);
    if (refreshToken) {
      try {
        await fetch('/auth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            action: 'revoke',
            token: refreshToken
          })
        });
      } catch (err) {
        // Best-effort revocation
      }
    }
    this._clearTokens();
    if (this.isStandalone()) {
      window.location.reload();
    }
  }

  /**
   * Store tokens from OAuth response
   */
  _storeTokens(data) {
    localStorage.setItem(this.accessTokenKey, data.access_token);
    if (data.refresh_token) {
      localStorage.setItem(this.refreshTokenKey, data.refresh_token);
    }
    const expiresAt = Date.now() + (data.expires_in * 1000);
    localStorage.setItem(this.expiresAtKey, expiresAt.toString());
  }

  /**
   * Clear all stored tokens
   */
  _clearTokens() {
    localStorage.removeItem(this.accessTokenKey);
    localStorage.removeItem(this.refreshTokenKey);
    localStorage.removeItem(this.expiresAtKey);
  }

  /**
   * Generate a random state string for CSRF protection
   */
  _generateRandomState() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }
}

// Create singleton instance
export const pwaAuth = new PWAAuth();
