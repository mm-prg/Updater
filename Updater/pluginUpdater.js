/**
 * ************************************************
 * Updater Plugin for FM-DX Webserver (check version below!)
 * ************************************************
 */


"use strict";

(async () => {
    const pluginVersion = '0.3.3dev';
    const pluginId = 'updater-plugin-ui-container';
    const defaultRepoOwner = 'mm-prg';
    let sortState = JSON.parse(localStorage.getItem('updater-sort-state') || '{"key": "status", "asc": false}');
    let sortTimeout = null;
    let showDevelopmentElements = false;
    const MAX_VERSION_CHECK_ATTEMPTS = 3;
    const descriptionPluginBarState = { initialized: false, wrapper: null, scrollArea: null, observer: null };

    function updateDevelopmentElementVisibility() {
        document.querySelectorAll('.updater-dev-only').forEach(element => {
            element.hidden = !showDevelopmentElements;
        });
    }

    window.addEventListener('keydown', event => {
        const shortcutMatch = event.ctrlKey && event.altKey && event.code === 'KeyD' && !event.repeat;
        if (shortcutMatch) {
            event.preventDefault();
            showDevelopmentElements = !showDevelopmentElements;
            updateDevelopmentElementVisibility();
        }
    });

    function injectDescriptionPluginBarStyles() {
        if (document.getElementById('updater-description-plugin-bar-styles')) return;

        const style = document.createElement('style');
        style.id = 'updater-description-plugin-bar-styles';
        style.textContent = `
            .updater-plugin-desc-wrapper {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-top: 10px;
                padding-top: 6px;
                border-top: 1px solid rgba(255,255,255,0.08);
            }
            .updater-plugin-desc-scroll-area {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 6px;
                flex: 1;
            }
            .updater-plugin-desc-scroll-area > * {
                flex-shrink: 0;
            }
        `;
        document.head.appendChild(style);
    }

    function closeServerDescriptionPage() {
        const descPanel = document.getElementById('dashboard-panel-description');
        if (!descPanel) return;

        // 1. Try finding explicit close button inside or associated with the description panel
        const closeBtn = descPanel.querySelector('.close, .close-button, .btn-close, .modal-close, [data-dismiss], [data-bs-dismiss], .fa-xmark, .fa-times, button[title*="Close" i], button[aria-label*="Close" i], [onclick*="close"], [onclick*="toggle"]');
        if (closeBtn && typeof closeBtn.click === 'function') {
            closeBtn.click();
            return;
        }

        // 2. Try parent modal/wrapper close button or hiding the modal
        const modalContainer = descPanel.closest('.modal, .modal-container, .popup, .overlay-container, .dashboard-modal, [role="dialog"]');
        if (modalContainer) {
            const modalCloseBtn = modalContainer.querySelector('.close, .close-button, .btn-close, [data-dismiss], .fa-xmark, .fa-times, button[title*="Close" i]');
            if (modalCloseBtn && typeof modalCloseBtn.click === 'function') {
                modalCloseBtn.click();
                return;
            }
            modalContainer.classList.remove('show', 'active', 'open', 'visible', 'is-open');
            modalContainer.style.display = 'none';
        }

        // 3. Try window/global helper functions if available
        if (typeof window.closeServerDescription === 'function') {
            window.closeServerDescription();
            return;
        }
        if (typeof window.toggleServerDescription === 'function') {
            window.toggleServerDescription();
            return;
        }
        if (typeof window.hideServerDescription === 'function') {
            window.hideServerDescription();
            return;
        }

        // 4. Hide/close description panel itself
        descPanel.classList.remove('show', 'active', 'open', 'visible', 'is-open');
        if (descPanel.style.display && descPanel.style.display !== 'none') {
            descPanel.style.display = 'none';
        }

        // 5. Hide any modal backdrop
        document.querySelectorAll('.modal-backdrop, .description-overlay, .server-desc-backdrop').forEach(el => {
            el.classList.remove('show', 'active', 'open');
            el.style.display = 'none';
        });

        // 6. Click any toggle button if panel is still displayed
        const toggleBtn = document.querySelector('#server-description-btn, #btn-server-desc, #server-desc-toggle, #description-toggle-btn, [data-action="toggle-description"]');
        if (toggleBtn && (descPanel.offsetHeight > 0 || descPanel.classList.contains('show') || descPanel.classList.contains('active'))) {
            toggleBtn.click();
        }
    }

    function mirrorButtonIntoDescriptionBar(button) {
        if (!button || !(button instanceof Element) || !descriptionPluginBarState.scrollArea) return;
        const mirrorKey = button.getAttribute('data-updater-desc-anchor') || button.id;
        if (!mirrorKey) return;

        const existingMirror = descriptionPluginBarState.scrollArea.querySelector(`[data-updater-desc-anchor="${mirrorKey}"]`);
        if (existingMirror) return;

        // The main toolbar can use custom tooltip attributes whose handlers are not cloned.
        const tooltipSource = button.getAttribute('data-tooltip') ||
            button.getAttribute('data-bs-original-title') ||
            button.getAttribute('title') ||
            button.getAttribute('aria-label') ||
            button.querySelector('[data-tooltip], [data-bs-original-title], [title]')?.getAttribute('data-tooltip') ||
            button.querySelector('[data-tooltip], [data-bs-original-title], [title]')?.getAttribute('data-bs-original-title') ||
            button.querySelector('[data-tooltip], [data-bs-original-title], [title]')?.getAttribute('title') ||
            button.textContent?.trim() ||
            'Plugin';
        const clone = button.cloneNode(true);
        clone.removeAttribute('id');
        clone.setAttribute('data-updater-desc-anchor', mirrorKey);
        clone.setAttribute('aria-label', button.getAttribute('aria-label') || tooltipSource);
        const usesServerTooltip = button.classList.contains('tooltip') || button.hasAttribute('data-tooltip');
        if (usesServerTooltip) {
            clone.classList.add('tooltip');
            clone.setAttribute('data-tooltip', button.getAttribute('data-tooltip') || tooltipSource);
            clone.setAttribute('data-tooltip-placement', button.getAttribute('data-tooltip-placement') || 'top');
            clone.removeAttribute('title');
        } else {
            clone.setAttribute('title', tooltipSource);
        }
        clone.removeAttribute('onclick');
        clone.style.pointerEvents = 'auto';

        clone.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeServerDescriptionPage();
            // Some plugins (e.g. Stream, LiveMap) use mousedown+mouseup instead of click
            // for their toggle logic (including long-press detection).
            // We simulate the full mouse event sequence so those handlers fire correctly.
            const opts = { bubbles: true, cancelable: true };
            button.dispatchEvent(new MouseEvent('mousedown', opts));
            button.dispatchEvent(new MouseEvent('mouseup', opts));
            button.dispatchEvent(new MouseEvent('click', opts));
        });

        descriptionPluginBarState.scrollArea.appendChild(clone);
        // Plugin buttons are added after the server initially binds its tooltips.
        // Bind the mirrored button through that same initializer to retain its style.
        if (usesServerTooltip && typeof window.initTooltips === 'function') {
            window.initTooltips(clone);
        }
    }

    function ensureDescriptionPluginBar() {
        if (descriptionPluginBarState.initialized) return;
        descriptionPluginBarState.initialized = true;

        injectDescriptionPluginBarStyles();

        const target = document.getElementById('dashboard-panel-description');
        if (!target) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'updater-plugin-desc-wrapper';

        const scrollArea = document.createElement('div');
        scrollArea.className = 'updater-plugin-desc-scroll-area';
        scrollArea.setAttribute('role', 'toolbar');
        scrollArea.setAttribute('aria-label', 'Plugin shortcuts');

        wrapper.appendChild(scrollArea);
        target.appendChild(wrapper);

        descriptionPluginBarState.wrapper = wrapper;
        descriptionPluginBarState.scrollArea = scrollArea;

        const mainBar = document.querySelector('.scrollable-container');
        if (mainBar) {
            Array.from(mainBar.children).forEach((child) => mirrorButtonIntoDescriptionBar(child));

            descriptionPluginBarState.observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node instanceof Element) {
                            if (node.matches('button, a, div')) {
                                mirrorButtonIntoDescriptionBar(node);
                            }
                            node.querySelectorAll('button, a, div').forEach((childNode) => mirrorButtonIntoDescriptionBar(childNode));
                        }
                    });

                    mutation.removedNodes.forEach((node) => {
                        if (node instanceof Element) {
                            const mirrorKey = node.getAttribute('id') || node.getAttribute('data-updater-desc-anchor');
                            if (mirrorKey) {
                                const mirror = descriptionPluginBarState.scrollArea?.querySelector(`[data-updater-desc-anchor="${mirrorKey}"]`);
                                if (mirror) mirror.remove();
                            }
                        }
                    });
                });
            });

            descriptionPluginBarState.observer.observe(mainBar, { childList: true, subtree: true });
        }
    }

    // Resolve the owner: priority to specific override, then author override, then author, finally default
    function resolveOwner(p, allPlugins) {
        if (p.repoUrl) {
            const match = p.repoUrl.match(/github\.com\/([^/ \n?#]+)/);
            if (match) return match[1];
        }
        if (p.githubOwner) return p.githubOwner;

        const authorOverride = (p.author && allPlugins) ? allPlugins.find(pl => pl.author === p.author && (pl.repoUrl || pl.githubOwner)) : null;
        if (authorOverride) {
            if (authorOverride.repoUrl) return authorOverride.repoUrl.match(/github\.com\/([^/]+)/)?.[1] || authorOverride.author;
            return authorOverride.githubOwner;
        }
        return authorOverride || p.author || defaultRepoOwner;
    }

    // Function to compare versions (identical to FavStations)
    function isNewer(curr, rem) {
        if (!curr || !rem) return false;
        const c = curr.split('.');
        const r = rem.split('.');
        for (let i = 0; i < Math.max(c.length, r.length); i++) {
            const remotePart = r[i] || "0";
            const currentPart = c[i] || "0";
            const cmp = remotePart.localeCompare(currentPart, undefined, { numeric: true, sensitivity: 'base' });
            if (cmp > 0) return true;
            if (cmp < 0) return false;
        }
        return false;
    }

    function updateRateLimitDisplay(rateLimit) {
        const tag = document.getElementById('updater-version-tag');
        if (tag && rateLimit && rateLimit.remaining != null) {
            const remaining = typeof rateLimit.remaining === 'number' ? rateLimit.remaining : parseInt(rateLimit.remaining);
            let color = '#fff';
            if (remaining < 10) color = '#fe0830';
            else if (remaining < 30) color = '#ffaa00';

            tag.innerHTML = `v${pluginVersion} (<strong style="color: ${color}; font-size: 14px; font-weight: bold;" title="Number of remaining GitHub API calls (resets after one hour)">api left ${rateLimit.remaining}</strong>)`;
        }
    }

    // Retrieve the version from the .js file on GitHub
    async function getRemoteVersion(p, allPlugins) {
        try {
            const owner = resolveOwner(p, allPlugins);
            let repo = p.name.replace(/\s+/g, '-');
            if (p.repoUrl) {
                const match = p.repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)(?:\/tree\/([^ \n?#]+))?/);
                if (match) repo = match[2];
            } else if (p.githubRepo) {
                repo = p.githubRepo;
            }

            const filePath = p.fileUrl || p.githubPath || p.fileName || p.frontEndPath;
            const branch = p.branch || 'main';

            // If filePath is a complete URL (e.g., pastebin), we use it directly
            const url = filePath.startsWith('http') ? filePath : `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;

            // Uses cache: 'no-store' and a timestamp to avoid browser/proxy cache
            const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
            if (!res.ok) return null;
            const text = await res.text();

            // Improved regex based on rds-ai-decoder.js: searches for const pluginVersion, version: '...', etc.
            const match = text.match(/(?:(?:const|var|let)\s+)?(?:pluginVersion|version)\s*[:=]\s*['"]([^'"]+)['"]/);
            return match ? match[1] : null;
        } catch (e) {
            return null;
        }
    }

    async function initUpdater() {
        let currentPlugins = [];
        let isListLoaded = false;
        let refreshListPromise = null;

        // Retrieve settings from the server (default advancedMode: true)
        let settings = { showInPluginPanel: true, showInHeader: true, showInSetup: true, showInServerDescription: true, advancedMode: true, customButtons: [] };
        try {
            const settingsRes = await fetch('/plugins/Updater/settings?t=' + Date.now());
            if (settingsRes.ok) {
                const data = await settingsRes.json();
                Object.assign(settings, data);
                // Migration fallback for legacy visibility settings
                settings.showInPluginPanel = data.showInPluginPanel ?? (data.visibility === 'both' || data.visibility === 'main' || true);
                settings.showInHeader = data.showInHeader ?? (data.visibility === 'both' || data.visibility === 'main' || true);
                settings.showInSetup = data.showInSetup ?? (data.visibility === 'both' || data.visibility === 'setup' || true);
                settings.showInServerDescription = data.showInServerDescription ?? true;
                settings.advancedMode = data.advancedMode ?? true;
            }
        } catch (e) { }

        // Ensure customButtons are initialized with defaults if missing
        while (settings.customButtons.length < 2)
            settings.customButtons.push({ label: `Custom ${settings.customButtons.length + 1}`, cmd: "" });

        // Determine admin status by checking the page text (as SysInfo does)
        const bodyText = document.body.textContent || document.body.innerText;
        const isAdmin = bodyText.includes("You are logged in as an administrator.") ||
            bodyText.includes("You are logged in as an adminstrator.");

        const isOnSetupPage = window.location.pathname.includes('/setup');
        const isMainPage = window.location.pathname === '/' || window.location.pathname.endsWith('/index.html') || window.location.pathname === '';

        // This shortcut bar is governed only by its own setting, so regular users can see it too.
        if (settings.showInServerDescription) ensureDescriptionPluginBar();

        // Initialize the interface only if:
        // 1. We are on the setup page (native administrative area)
        // 2. We are on the main page AND the user is an administrator (to show the button)

        // Respect visibility settings
        if (isOnSetupPage && !settings.showInSetup) return;
        if (isMainPage && !settings.showInPluginPanel && !settings.showInHeader) return;

        if (!isOnSetupPage && !(isMainPage && isAdmin)) return;

        console.log(`[Updater] Initializing. Admin: ${isAdmin}, SetupPage: ${isOnSetupPage}`, settings);

        if (document.getElementById(pluginId)) return;

        // Inject native styles as a fallback and for specific overrides
        const styleBlock = document.createElement('style');
        styleBlock.textContent = `
            .updater-card { background: #222; padding: 15px; border-radius: 6px; border: 1px solid #333; margin-bottom: 20px; color: #ddd; box-sizing: border-box; text-align: left; }
            .updater-list { list-style: none; padding: 0; margin: 0; box-sizing: border-box; }
            .updater-list-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-left: 3px solid #3fa9f5; background: #1a1a1a; margin-bottom: 8px; border-radius: 4px; color: #ddd; transition: background 0.2s; box-sizing: border-box; min-height: 48px; }
            .updater-list-item:hover { background: #262626; }
            .updater-btn { display: inline-flex !important; align-items: center !important; justify-content: center !important; padding: 4px 8px !important; border: none !important; border-radius: 4px !important; cursor: pointer !important; font-size: 11px !important; font-weight: bold !important; transition: opacity 0.2s !important; text-decoration: none !important; white-space: nowrap !important; width: auto !important; height: auto !important; min-width: 0 !important; max-width: none !important; flex: 0 0 auto !important; box-sizing: border-box !important; line-height: 1.2 !important; margin: 0 !important; }
            .updater-btn:hover { opacity: 0.85 !important; }
            .updater-btn-primary { background: #3fa9f5 !important; color: #000 !important; }
            .updater-btn-danger { background: #fe0830 !important; color: #fff !important; }
            .updater-btn-small { display: inline-flex !important; align-items: center !important; justify-content: center !important; padding: 3px 6px !important; font-size: 10px !important; height: 22px !important; line-height: 1 !important; white-space: nowrap !important; width: auto !important; flex: 0 0 auto !important; margin: 0 !important; box-sizing: border-box !important; }
            .updater-server-reinstall-btn, .updater-server-history-btn { margin-left: 8px !important; }
            .updater-dev-only[hidden] { display: none !important; }
            .actions-container { display: flex !important; gap: 3px !important; align-items: center !important; flex-wrap: nowrap !important; justify-content: flex-end !important; width: auto !important; min-width: 0 !important; }
            .actions-container button, .actions-container a { display: inline-flex !important; align-items: center !important; justify-content: center !important; width: auto !important; height: 22px !important; flex: 0 0 auto !important; margin: 0 !important; padding: 3px 6px !important; font-size: 10px !important; box-sizing: border-box !important; line-height: 1 !important; white-space: nowrap !important; }
            .updater-title { color: #fff; margin: 0; font-size: 1.2em; font-weight: bold; box-sizing: border-box; }
            .updater-subtitle { color: #aaa; font-size: 0.85em; margin-top: 2px; }
            .updater-sort-link { color: #3fa9f5; cursor: pointer; text-decoration: none; font-size: 11px; margin-right: 0; box-sizing: border-box; }
            .updater-sort-link:hover { text-decoration: underline; }
        `;
        document.head.appendChild(styleBlock);

        const container = document.createElement('div');
        container.id = pluginId;
        container.className = 'card updater-card';

        // Define different styles depending on the page
        if (isOnSetupPage) {
            container.style.cssText = `
                margin: 20px 0;
                padding: 15px;
                background: rgba(15, 15, 15, 0.95);
                border: 1px solid #00ff00;
                border-radius: 8px;
                color: #fff;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            `;
        } else {
            container.style.cssText = `
                margin: 0;
                padding: 15px;
                background: rgba(15, 15, 15, 0.95);
                border: 1px solid #00ff00;
                border-radius: 8px;
                color: #fff;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                box-shadow: 0 10px 30px rgba(0,0,0,0.8);
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 10000;
                max-height: 90vh;
                overflow-y: auto;
                width: 92%;
                max-width: 1200px;
                display: none; /* Hidden by default on the home page */
            `;
        }

        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 10px;">
                <h3 class="updater-title">Installed Plugins</h3>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <a href="https://github.com/mm-prg/Updater" target="_blank" class="updater-btn" style="background:#333; color:#fff; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; width:32px; padding:6px;" title="Updater Repository"><i class="fa-solid fa-circle-question"></i></a>
                    <button id="updater-config-btn" class="updater-btn" style="background:#333; color:#fff; display:${settings.advancedMode ? 'inline-flex' : 'none'}; align-items:center; justify-content:center; width:32px; padding:6px;" title="Advanced Tools"><i class="fa-solid fa-screwdriver-wrench"></i></button>
                    <button id="updater-options-btn" class="updater-btn" style="background:#333; color:#fff; display:inline-flex; align-items:center; justify-content:center; width:32px; padding:6px;" title="Options"><i class="fa-solid fa-gear"></i></button>
                    <span id="updater-version-tag" style="color: #777; font-size: 14px;">v${pluginVersion} (<strong style="color: #fff; font-size: 14px; font-weight: bold;" title="Number of remaining GitHub API calls (resets after one hour)">api left ?</strong>)</span>
                </div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <div>
                    <div id="updater-status" class="updater-subtitle" style="color: #3fa9f5; font-weight: bold;">Scanning...</div>
                    <div id="updater-server-status" aria-live="polite"></div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button id="refresh-list-btn" class="updater-btn" style="width: fit-content; background: #333; color: #fff; border: 1px solid #444;" title="Re-scan the plugins directory to update the list"><i class="fa-solid fa-sync"></i>&nbsp;Refresh list</button>
                    <button id="add-plugin-btn" class="updater-btn updater-btn-primary" style="width: fit-content;" title="Install a new plugin by providing its GitHub repository URL">Add new plugin</button>
                    <button id="restart-server-btn" class="updater-btn" style="width: fit-content; background: #8b1a1a; color: #fff; border: 1px solid #b22222;" title="Restart the FM-DX Webserver"><i class="fa-solid fa-arrow-rotate-right"></i>&nbsp;Restart server</button>
                </div>
            </div>
            
            <div id="updater-sort-controls" class="updater-list-item" style="background: transparent; border-left-color: transparent; border-bottom: 1px solid #333; border-radius: 0; margin-bottom: 10px; padding-top: 0; padding-bottom: 5px; opacity: 0.8; font-weight: bold; text-transform: uppercase; cursor: default; text-align: left;">
                <div style="flex-grow: 1; display: flex; align-items: center; gap: 10px; overflow: hidden; min-width: 0;">
                    <div class="updater-sort-link" data-sort="name" style="flex: 0 0 24%; text-align: left !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;">Name ↕</div>
                    <div class="updater-sort-link" data-sort="author" style="flex: 0 0 15%; text-align: left !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;">Author ↕</div>
                    <div style="flex: 0 0 6%; color: #3fa9f5; font-size: 11px; text-align: left !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; box-sizing: border-box;">Local</div>
                    <div style="flex: 0 0 8%; color: #3fa9f5; font-size: 11px; text-align: left !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; box-sizing: border-box;">GitHub</div>
                    <div class="updater-sort-link" data-sort="status" style="flex: 1; text-align: left !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;">Status ↕</div>
                </div>
                <div style="min-width: 320px; flex-shrink: 0; margin-left: 10px; display: flex; justify-content: flex-end;"></div>
            </div>

            <ul id="updater-list-body" class="updater-list"></ul>

            <div style="font-size: 11px; color: #666; margin-top: 15px; padding-top: 10px; border-top: 1px solid #333; text-align: center;">
                <i class="fa-solid fa-circle-info"></i> <b>Tip:</b> Use <b>Edit</b> to link a GitHub repository, then <b>Update</b> to sync files. <b>Explore</b> allows you to manage local files.
            </div>
        `;

        // Insertion into the Webserver UI
        if (isOnSetupPage) {
            // On the setup page, we insert it into the specific target and make it visible.
            const target = document.getElementById('plugin-settings') || document.body;
            // Display is already 'block' from cssText
            target.appendChild(container);
        } else {
            document.body.appendChild(container);
            // Add an overlay for the modal
            const overlay = document.createElement('div');
            overlay.id = `${pluginId}-overlay`;
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                z-index: 9999;
                display: none;
            `;
            document.body.appendChild(overlay);

            overlay.onclick = () => {
                container.style.display = 'none';
                overlay.style.display = 'none';
            };
        }
        // Create the button to open the plugin list on the main page
        // This button is created only if we are not on the setup page.
        if (!isOnSetupPage) {
            if (settings.showInPluginPanel) createOpenPluginListButton(container);
            if (settings.showInHeader) createHeaderButton(container);
        }


        document.getElementById('refresh-list-btn').onclick = async () => {
            const status = document.getElementById('updater-status');
            if (status) status.textContent = "Refreshing list, please click on 'Refresh list' in a few seconds";
            await refreshList();
        };
        document.getElementById('add-plugin-btn').onclick = () => openAddModal(currentPlugins);
        document.getElementById('restart-server-btn').onclick = async () => {
            if (!confirm('Restart the server? All listeners will be disconnected.')) return;

            const button = document.getElementById('restart-server-btn');
            button.disabled = true;
            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>&nbsp;Restarting...';

            try {
                const response = await fetch('/restart', { method: 'POST' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const status = document.getElementById('updater-status');
                if (status) status.textContent = 'Server is restarting; the page will reload shortly.';
                setTimeout(() => location.reload(), 8000);
            } catch (error) {
                console.error('[Updater] Unable to restart the server:', error);
                alert('Unable to restart the server. Please update fm-dx-webserver and try again.');
                button.disabled = false;
                button.innerHTML = '<i class="fa-solid fa-arrow-rotate-right"></i>&nbsp;Restart server';
            }
        };
        document.getElementById('updater-options-btn').onclick = (event) => toggleOptionsDropdown(event);
        document.getElementById('updater-config-btn').onclick = (event) => toggleConfigFilesDropdown(event);
        function createOpenPluginListButton(modalContainer) {
            const btnId = 'updater-open-btn';
            const overlay = document.getElementById(`${pluginId}-overlay`);

            const tryAdd = (attempts = 0) => {
                if (document.getElementById(btnId)) return;

                // Use the webserver's standard API to add the icon to the plugin panel
                if (typeof window.addIconToPluginPanel !== 'function') {
                    if (attempts < 30) setTimeout(() => tryAdd(attempts + 1), 300);
                    return;
                }

                window.addIconToPluginPanel(btnId, 'Updater', 'solid', 'cloud-arrow-down', 'Updater ' + pluginVersion);

                const btn = document.getElementById(btnId);
                if (btn) {
                    btn.classList.add('hide-phone', 'bg-color-2');
                    btn.onclick = () => togglePluginListUI(modalContainer);
                } else if (attempts < 30) {
                    setTimeout(() => tryAdd(attempts + 1), 300);
                }
            };
            tryAdd();
        }

        function createHeaderButton(modalContainer) {
            const tryAddHeader = (attempts = 0) => {
                // Se siamo nella pagina di setup, non cerchiamo il pulsante nell'header
                if (window.location.pathname.includes('/setup')) return;

                if (document.getElementById('updater-header-btn')) return;

                // Seguendo la logica di Simple_Clock: puntiamo al container reale della barra superiore
                const headerContainer = document.querySelector(".dashboard-panel .panel-100-real");

                if (!headerContainer) {
                    if (attempts < 40) {
                        if (attempts % 10 === 0) console.log(`[Updater] Attesa caricamento header container... (tentativo ${attempts})`);
                        setTimeout(() => tryAddHeader(attempts + 1), 500);
                    }
                    return;
                }

                // Cerchiamo il pulsante menu SOLO dentro il container della barra superiore
                let menuButton = headerContainer.querySelector("#menuButton") || headerContainer.querySelector("#setupButton");

                if (!menuButton) {
                    menuButton = [...headerContainer.querySelectorAll(".headerButton, div")]
                        .find(el => el.textContent.trim() === "☰" || el.innerHTML.includes('fa-bars') || el.innerHTML.includes('fa-gear'));
                }

                if (!menuButton) {
                    // Se ancora non c'è, riprova (magari i pulsanti interni caricano dopo il container)
                    setTimeout(() => tryAddHeader(attempts + 1), 500);
                    return;
                }

                //                console.log(`[Updater] Anchor trovato (${menuButton.id || 'per contenuto'}). Iniezione pulsante...`);
                const headerBtn = document.createElement("div");
                headerBtn.id = "updater-header-btn";
                // Utilizza solo la classe standard 'headerButton' per evitare di ereditare stili indesiderati
                headerBtn.className = "headerButton";
                headerBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i>';
                headerBtn.title = "Updater " + pluginVersion;
                headerBtn.style.cursor = "pointer";
                // Aggiungi stili di base per garantire la visibilità e l'allineamento
                headerBtn.style.display = "flex";
                headerBtn.style.alignItems = "center";
                headerBtn.style.justifyContent = "center";
                headerBtn.style.padding = "6px";
                headerBtn.style.fontSize = "18px"; // Regola la dimensione del font se necessario
                headerBtn.style.color = "var(--color-4, #E6C269)"; // Usa un colore del tema per coerenza

                menuButton.insertAdjacentElement("beforebegin", headerBtn);
                //                console.log("[Updater] Header button inserted successfully.");

                headerBtn.onclick = () => togglePluginListUI(modalContainer);
            };
            tryAddHeader();
        }

        async function togglePluginListUI(modalContainer) {
            const pluginOverlay = document.getElementById(`${pluginId}-overlay`);
            const isVisible = modalContainer.style.display === 'block';
            if (isVisible) {
                modalContainer.style.display = 'none';
                if (pluginOverlay) pluginOverlay.style.display = 'none';
                return;
            }

            if (!isListLoaded) {
                alert('The local plugin list is not ready yet');
            }

            modalContainer.style.display = 'block';
            if (pluginOverlay) pluginOverlay.style.display = 'block';

            if (!isListLoaded) {
                const status = document.getElementById('updater-status');
                if (status) status.textContent = 'Scanning local plugins...';
                const loaded = await refreshList();
                if (!loaded && status) status.textContent = 'Plugin list could not be loaded. Please try Refresh list.';
            }
        }

        function updateStatusCell(p, remoteVer, allPlugins) {
            const statusId = `status-${p.name.replace(/\s+/g, '_')}`;
            const statusCell = document.getElementById(statusId);
            if (!statusCell) return;

            const remoteVerId = `remote-ver-${p.name.replace(/\s+/g, '_')}`;
            const remoteVerCell = document.getElementById(remoteVerId);
            if (remoteVerCell) {
                remoteVerCell.innerHTML = remoteVer ? `<span style="color: #fff;">${remoteVer}</span>` : '<span style="color: #777;">??</span>';
            }

            const owner = resolveOwner(p, allPlugins);
            let repo = p.name.replace(/\s+/g, '-');
            if (p.repoUrl) {
                const match = p.repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)/);
                if (match) repo = match[2];
            } else if (p.githubRepo) {
                repo = p.githubRepo;
            }
            const filePath = p.fileUrl || p.githubPath || p.fileName || p.frontEndPath;

            const fullRepoUrl = p.repoUrl || `https://github.com/${owner}/${repo}`;
            const branch = p.branch || 'main';
            const fullFileUrl = filePath.startsWith('http') ? filePath : `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
            statusCell.title = `Repository: ${fullRepoUrl}\nDescriptor: ${fullFileUrl}\nDirectory: ${p.localDir || '(root)'}`;

            if (!remoteVer) {
                statusCell.innerHTML = `<span style="color: #ffaa00;">Repo not found, please edit data!</span>`;
            } else {
                const viewLink = `<a href="${fullRepoUrl}" target="_blank" style="margin-left:5px; color:#3fa9f5; text-decoration:underline; font-size:10px;">Repo</a>`;

                if (isNewer(p.version || "0.0.0", remoteVer)) {
                    statusCell.innerHTML = `<span style="color: #fe0830; font-weight: bold;">🚀 Update: ${remoteVer}</span> ${viewLink}`;
                } else {
                    statusCell.innerHTML = `<span style="color: #00ff00;">✓ Up to date</span> ${viewLink}`;
                }
            }

            const actionsContainer = statusCell.closest('li')?.querySelector('.actions-container');
            if (actionsContainer) {
                actionsContainer.querySelectorAll('.updater-update-btn, .updater-reinstall-btn, .updater-branch-btn, .updater-plugin-commits-btn').forEach(b => b.remove());
                let updateButton = null;

                if (remoteVer) {
                    const isUpdate = isNewer(p.version || "0.0.0", remoteVer);
                    const configuredBranch = p.branch || 'main';

                    const createBtn = (branch, label) => {
                        const btn = document.createElement('button');
                        const btnClass = isUpdate ? 'updater-update-btn' : 'updater-reinstall-btn';
                        btn.className = `updater-btn updater-btn-small ${btnClass}`;
                        btn.textContent = label;
                        btn.style.background = isUpdate ? '#fe0830' : '#444';
                        btn.style.color = '#fff';
                        btn.title = isUpdate ? `Update ${branch} to ${remoteVer}` : `Reinstall current version from ${branch}`;
                        btn.onclick = () => performUpdate(p, branch);
                        return btn;
                    };

                    updateButton = createBtn(configuredBranch, isUpdate ? 'Update' : 'Reinstall');
                    actionsContainer.prepend(updateButton);
                }

                const hasGitHubRepository = p.repoUrl || (p.githubOwner && p.githubRepo);
                const descriptorPath = [p.fileUrl, p.githubPath, p.frontEndPath, p.fileName]
                    .find(filePath => typeof filePath === 'string' && filePath && !/^https?:\/\//i.test(filePath));
                if (settings.advancedMode && hasGitHubRepository && descriptorPath) {
                    const commitsButton = document.createElement('button');
                    commitsButton.className = 'updater-btn updater-btn-small updater-plugin-commits-btn';
                    commitsButton.textContent = 'Commits';
                    commitsButton.title = `Install a previous version of ${p.name}`;
                    commitsButton.onclick = () => openPluginCommitsModal(p, commitsButton);
                    if (updateButton) updateButton.insertAdjacentElement('afterend', commitsButton);
                    else actionsContainer.prepend(commitsButton);
                }
                updateDevelopmentElementVisibility();
            }
        }

        async function checkUpdate(p, allPlugins) {
            p.versionCheckAttempts = (p.versionCheckAttempts || 0) + 1;
            const remoteVer = await getRemoteVersion(p, allPlugins);
            p.cachedRemoteVer = remoteVer;
            if (remoteVer) {
                p.versionCheckAttempts = 0;
                p.versionCheckStopped = false;
            } else {
                if (p.versionCheckAttempts >= MAX_VERSION_CHECK_ATTEMPTS) {
                    p.versionCheckStopped = true;
                }
            }

            // If the check was successful (version found) and we had no saved parameters,
            // store the automatically detected values in plugins_data.json for future runs.
            if (remoteVer && (!p.repoUrl || !p.fileUrl)) {
                const owner = resolveOwner(p, allPlugins);
                const repo = p.githubRepo || p.name.replace(/\s+/g, '-');
                const filePath = p.fileUrl || p.githubPath || p.fileName || p.frontEndPath;

                const repoUrl = p.repoUrl || `https://github.com/${owner}/${repo}`;
                const fileUrl = filePath;
                const localDir = p.localDir || "";

                fetch('/plugins/Updater/save-override', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pluginName: (p.branch && p.branch !== 'main' && p.name.includes('(')) ? p.name : (p.logicalName || p.name),
                        repoUrl: repoUrl,
                        fileUrl: fileUrl,
                        localDir: localDir
                    })
                }).then(res => res.json()).then(data => {
                    if (data.rateLimit) updateRateLimitDisplay(data.rateLimit);
                    if (data.ok) {
                        p.repoUrl = repoUrl; p.fileUrl = fileUrl; p.localDir = localDir;
                        renderPluginRows();
                    }
                }).catch(() => { });
            }

            updateStatusCell(p, remoteVer, allPlugins);

            // Se l'ordinamento attivo è per status, rinfresca l'ordine man mano che arrivano i dati
            if (sortState.key === 'status') {
                clearTimeout(sortTimeout);
                sortTimeout = setTimeout(() => sortPlugins('status', false), 500);
            }
        }

        async function maintainServer(reinstall, button) {
            const action = reinstall ? 'reinstall' : 'update';
            const warning = reinstall
                ? 'Reinstall the current FM-DX Webserver version and restart it? This restores all tracked server files and discards local changes to them. All listeners will be disconnected.'
                : 'Update the FM-DX Webserver and restart it? All listeners will be disconnected. The update is cancelled if the server working tree has local changes.';
            if (!confirm(warning)) return;

            button.disabled = true;
            button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>&nbsp;${reinstall ? 'Reinstalling...' : 'Updating...'}`;

            try {
                let response = await fetch('/plugins/Updater/update-server', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reinstall })
                });
                let result = await response.json();

                // Offer an explicit destructive retry only when the regular update is
                // blocked by local changes in the server working tree.
                if (!reinstall && response.status === 409 && /working tree has local changes/i.test(result.error || '')) {
                    const overwrite = confirm(
                        'The server has local tracked changes. Download the update anyway and overwrite those files?\n\n' +
                        'This permanently discards local changes to tracked server files. Untracked files are kept.'
                    );
                    if (overwrite) {
                        button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>&nbsp;Overwriting and updating...';
                        response = await fetch('/plugins/Updater/update-server', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ force: true })
                        });
                        result = await response.json();
                    } else {
                        button.disabled = false;
                        button.innerHTML = '<i class="fa-solid fa-download"></i>&nbsp;Update server';
                        return;
                    }
                }
                if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);

                const status = document.getElementById('updater-status');
                if (status) status.textContent = reinstall
                    ? 'Server reinstalled; restarting now...'
                    : (result.updated ? (result.forced ? 'Server updated and local changes overwritten; restarting now...' : 'Server updated; restarting now...') : 'Server is already up to date; restarting now...');
                const restartResponse = await fetch('/restart', { method: 'POST' });
                if (!restartResponse.ok) throw new Error(`Unable to restart the server (HTTP ${restartResponse.status})`);
                setTimeout(() => location.reload(), 8000);
            } catch (error) {
                console.error(`[Updater] Unable to ${action} the server:`, error);
                alert(`Unable to ${action} the server: ${error.message}`);
                button.disabled = false;
                button.innerHTML = reinstall
                    ? '<i class="fa-solid fa-arrows-rotate"></i>&nbsp;Reinstall server'
                    : '<i class="fa-solid fa-download"></i>&nbsp;Update server';
            }
        }

        async function installServerCommit(commit, button) {
            const shortCommit = commit.slice(0, 7);
            if (!confirm(
                `Install FM-DX Webserver commit ${shortCommit} and restart the server?\n\n` +
                'This replaces tracked server files and discards local changes to those files.'
            )) return;

            const originalHtml = button.innerHTML;
            button.disabled = true;
            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>&nbsp;Installing...';
            try {
                const response = await fetch('/plugins/Updater/install-server-commit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ commit, force: true })
                });
                const result = await response.json();
                if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);

                const status = document.getElementById('updater-status');
                if (status) status.textContent = `Server commit ${shortCommit} installed; restarting now...`;
                const restartResponse = await fetch('/restart', { method: 'POST' });
                if (!restartResponse.ok) throw new Error(`Unable to restart the server (HTTP ${restartResponse.status})`);
                setTimeout(() => location.reload(), 8000);
            } catch (error) {
                console.error('[Updater] Unable to install the selected server version:', error);
                alert(`Unable to install server commit ${shortCommit}: ${error.message}`);
                button.disabled = false;
                button.innerHTML = originalHtml;
            }
        }

        async function toggleServerCommitList(button) {
            const serverInfo = document.getElementById('updater-server-status');
            const existingList = serverInfo?.querySelector('#updater-server-commit-list');
            if (existingList) {
                existingList.remove();
                button.setAttribute('aria-expanded', 'false');
                return;
            }

            const originalHtml = button.innerHTML;
            button.disabled = true;
            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>&nbsp;Loading...';
            try {
                const response = await fetch('/plugins/Updater/server-commits');
                const result = await response.json();
                if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);

                const panel = document.createElement('div');
                panel.id = 'updater-server-commit-list';
                panel.className = 'updater-dev-only';
                panel.style.cssText = 'display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:8px; padding:8px; background:#1a1a1a; border:1px solid #444; color:#ddd;';

                const select = document.createElement('select');
                select.setAttribute('aria-label', 'Select a recent FM-DX Webserver commit');
                select.style.cssText = 'flex:1 1 260px; min-width:180px; padding:6px; background:#222; color:#fff; border:1px solid #555;';
                result.commits.forEach(commit => {
                    const option = document.createElement('option');
                    const date = new Date(commit.date).toLocaleString();
                    option.value = commit.sha;
                    option.textContent = `v${commit.version || 'unknown'} - ${commit.sha.slice(0, 7)} - ${commit.message} (${date})`;
                    option.title = commit.sha;
                    select.appendChild(option);
                });

                const installButton = document.createElement('button');
                installButton.type = 'button';
                installButton.className = 'updater-btn updater-btn-small';
                installButton.style.cssText = 'background:#8b1a1a; color:#fff;';
                installButton.innerHTML = '<i class="fa-solid fa-download"></i>&nbsp;Install selected version';
                installButton.disabled = result.commits.length === 0;
                installButton.onclick = () => installServerCommit(select.value, installButton);

                panel.append(select, installButton);
                serverInfo.appendChild(panel);
                button.setAttribute('aria-expanded', 'true');
                updateDevelopmentElementVisibility();
            } catch (error) {
                console.error('[Updater] Unable to load server commit history:', error);
                alert(`Unable to load previous server versions: ${error.message}`);
            } finally {
                button.disabled = false;
                button.innerHTML = originalHtml;
            }
        }

        async function checkServerUpdate(localVer) {
            const status = document.getElementById('updater-status');
            if (!status) return;

            try {
                const remoteUrl = 'https://raw.githubusercontent.com/NoobishSVK/fm-dx-webserver/main/package.json';
                const res = await fetch(remoteUrl + '?t=' + Date.now());
                if (!res.ok) return;
                const pkg = await res.json();
                const remoteVer = pkg.version;

                const serverInfo = document.getElementById('updater-server-status');
                if (!serverInfo) return;
                serverInfo.style.cssText = 'font-size: 11px; margin-top: 5px; padding-top: 5px; border-top: 1px solid #333;';

                if (remoteVer && isNewer(localVer, remoteVer)) {
                    serverInfo.style.color = '#fe0830';
                    serverInfo.style.fontWeight = 'bold';
                    serverInfo.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Server update available: v${remoteVer} (local: v${localVer}) <a href="https://github.com/NoobishSVK/fm-dx-webserver" target="_blank" style="color:#3fa9f5; text-decoration:underline; margin-left:5px;">Repo</a><button id="updater-server-update-btn" class="updater-btn updater-btn-small updater-dev-only" style="background:#8b1a1a; color:#fff; margin-left:8px;" title="Download the official FM-DX Webserver update and restart the server"><i class="fa-solid fa-download"></i>&nbsp;Update server</button>`;
                    serverInfo.querySelector('#updater-server-update-btn').onclick = () => maintainServer(false, serverInfo.querySelector('#updater-server-update-btn'));
                } else {
                    serverInfo.style.color = '#777';
                    serverInfo.innerHTML = `<i class="fa-solid fa-check"></i> Server version: v${localVer} (Up to date) <a href="https://github.com/NoobishSVK/fm-dx-webserver" target="_blank" style="color:#3fa9f5; text-decoration:underline; margin-left:5px;">Repo</a><button id="updater-server-reinstall-btn" class="updater-btn updater-btn-small updater-dev-only updater-server-reinstall-btn" style="background:#444; color:#fff; margin-left:8px;" title="Restore all tracked files of the installed FM-DX Webserver version and restart the server"><i class="fa-solid fa-arrows-rotate"></i>&nbsp;Reinstall server</button>`;
                    serverInfo.querySelector('#updater-server-reinstall-btn').onclick = () => maintainServer(true, serverInfo.querySelector('#updater-server-reinstall-btn'));
                }
                const historyButton = document.createElement('button');
                historyButton.type = 'button';
                historyButton.className = 'updater-btn updater-btn-small updater-dev-only updater-server-history-btn';
                historyButton.style.cssText = 'background:#444; color:#fff; margin-left:8px;';
                historyButton.title = 'Choose one of the ten most recent server commits';
                historyButton.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i>&nbsp;Commits';
                historyButton.onclick = () => toggleServerCommitList(historyButton);
                serverInfo.appendChild(historyButton);
                updateDevelopmentElementVisibility();
            } catch (e) {
                console.error('[Updater] Server version check failed:', e);
            }
        }

        async function refreshList() {
            if (refreshListPromise) return refreshListPromise;

            refreshListPromise = (async () => {
                try {
                    const response = await fetch('/plugins/Updater/list?t=' + Date.now());
                    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    const data = await response.json();
                    const newList = data.plugins || data;

                    // Preserve dynamic data (like cached remote version) to maintain Status sorting,
                    // but reset the retry state for plugins when the list is freshly loaded.
                    newList.forEach(np => {
                        const old = currentPlugins.find(p => p.name === np.name);
                        if (old) {
                            if (old.cachedRemoteVer !== null && old.cachedRemoteVer !== undefined) {
                                np.cachedRemoteVer = old.cachedRemoteVer;
                            }
                            np.versionCheckAttempts = 0;
                            np.versionCheckStopped = false;
                        }
                    });

                    currentPlugins = newList;
                    isListLoaded = true;
                    if (data.rateLimit) updateRateLimitDisplay(data.rateLimit);
                    sortPlugins(sortState.key, false);
                    const status = document.getElementById('updater-status');
                    if (status) {
                        status.innerHTML = `<div>Detected ${currentPlugins.length} plugins installed in the system.</div>`;
                        if (data.serverVersion) checkServerUpdate(data.serverVersion);
                    }
                    return true;
                } catch (e) {
                    console.log('[Updater] UI still initializing, please wait: ', e);
                    return false;
                }
            })();

            const currentRefresh = refreshListPromise;
            try {
                return await currentRefresh;
            } finally {
                if (refreshListPromise === currentRefresh) refreshListPromise = null;
            }
        }

        async function openPluginCommitsModal(p, button) {
            const owner = resolveOwner(p, currentPlugins);
            let repo = p.name.replace(/\s+/g, '-');
            if (p.repoUrl) {
                const match = p.repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)/);
                if (match) repo = match[2];
            } else if (p.githubRepo) {
                repo = p.githubRepo;
            }
            const repoUrl = p.repoUrl || `https://github.com/${owner}/${repo}`;
            const descriptorPath = [p.fileUrl, p.githubPath, p.frontEndPath, p.fileName]
                .find(filePath => typeof filePath === 'string' && filePath && !/^https?:\/\//i.test(filePath));
            if (!descriptorPath) {
                alert(`Unable to find the GitHub descriptor path for ${p.name}.`);
                return;
            }

            const originalText = button.textContent;
            button.disabled = true;
            button.textContent = 'Loading...';
            try {
                const params = new URLSearchParams({
                    repoUrl,
                    branch: p.branch || 'main',
                    descriptorPath
                });
                const response = await fetch(`/plugins/Updater/plugin-commits?${params}`);
                const result = await response.json();
                if (result.rateLimit) updateRateLimitDisplay(result.rateLimit);
                if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
                if (!result.commits.length) {
                    alert(`No versioned commits were found for ${p.name}.`);
                    return;
                }

                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed; inset:0; z-index:100001; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(0,0,0,0.75);';
                const modal = document.createElement('div');
                modal.setAttribute('role', 'dialog');
                modal.setAttribute('aria-modal', 'true');
                modal.style.cssText = 'width:min(640px, 100%); max-height:85vh; overflow:auto; padding:20px; background:#161616; border:1px solid #444; border-radius:6px; color:#eee;';

                const heading = document.createElement('h3');
                heading.textContent = `${p.name} commits`;
                heading.style.cssText = 'margin:0 0 14px; font-size:18px;';
                const select = document.createElement('select');
                select.setAttribute('aria-label', `Select a ${p.name} version`);
                select.style.cssText = 'width:100%; min-width:0; padding:8px; background:#222; color:#fff; border:1px solid #555;';
                result.commits.forEach(commit => {
                    const option = document.createElement('option');
                    option.value = commit.sha;
                    option.textContent = `v${commit.version} - ${commit.sha.slice(0, 7)} - ${commit.message} (${new Date(commit.date).toLocaleString()})`;
                    option.title = commit.sha;
                    select.appendChild(option);
                });

                const buttons = document.createElement('div');
                buttons.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; margin-top:14px;';
                const closeButton = document.createElement('button');
                closeButton.className = 'updater-btn updater-btn-small';
                closeButton.textContent = 'Close';
                closeButton.onclick = () => overlay.remove();
                const installButton = document.createElement('button');
                installButton.className = 'updater-btn updater-btn-small';
                installButton.style.cssText = 'background:#8b1a1a; color:#fff;';
                installButton.textContent = 'Install selected version';
                installButton.onclick = () => {
                    const commit = select.value;
                    overlay.remove();
                    performUpdate(p, null, commit);
                };

                buttons.append(closeButton, installButton);
                modal.append(heading, select, buttons);
                overlay.appendChild(modal);
                overlay.addEventListener('click', event => {
                    if (event.target === overlay) overlay.remove();
                });
                document.body.appendChild(overlay);
            } catch (error) {
                console.error(`[Updater] Unable to load commits for ${p.name}:`, error);
                alert(`Unable to load commits for ${p.name}: ${error.message}`);
            } finally {
                button.disabled = false;
                button.textContent = originalText;
            }
        }

        async function performUpdate(p, branchOverride = null, commitOverride = null) {
            // Determine if this is a standard version upgrade or a forced reinstallation
            const targetBranch = commitOverride || branchOverride || p.branch || 'main';
            const isUpdate = isNewer(p.version || "0.0.0", p.cachedRemoteVer);

            let msg = commitOverride
                ? `Install ${p.name} from commit ${commitOverride.slice(0, 7)}?`
                : (isUpdate ? `Update ${p.name} to version ${p.cachedRemoteVer}?` : `Reinstall ${p.name} version ${p.version}?`);
            if (branchOverride && branchOverride !== p.branch) {
                msg = `Switch ${p.name} to branch "${branchOverride}" and download files?`;
            }
            if (!confirm(msg)) return;

            // If changing branch, save the preference on the server before proceeding
            if (branchOverride && branchOverride !== p.branch) {
                try {
                    await fetch('/plugins/Updater/save-override', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pluginName: (p.branch && p.branch !== 'main' && p.name.includes('(')) ? p.name : (p.logicalName || p.name), branch: branchOverride })
                    });
                    p.branch = branchOverride;
                } catch (e) { console.error("Failed to save branch override"); }
            }

            // Resolve the repository owner and name from the plugin's metadata or URL
            const owner = resolveOwner(p, currentPlugins);
            let repo = p.name.replace(/\s+/g, '-');
            if (p.repoUrl) {
                const match = p.repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)/);
                if (match) repo = match[2];
            }

            // Identify the remote descriptor path and set up the base URL for raw GitHub content
            const remoteDescriptorPath = p.fileUrl || p.githubPath || p.fileName || p.frontEndPath;
            let skipRecursive = false;

            // Build the GitHub "raw" base URL
            const rawBaseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${targetBranch}`;

            // Provide immediate visual feedback in the status cell
            const statusId = `status-${p.name.replace(/\s+/g, '_')}`;
            const statusCell = document.getElementById(statusId);
            if (statusCell) {
                statusCell.innerHTML = '<span style="color: #fe0830; font-weight: bold;">Updating...</span>';
            }

            try {
                // Call the backend endpoint to perform the actual file download and replacement
                const res = await fetch('/plugins/Updater/update-plugin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pluginName: (p.branch && p.branch !== 'main') ? p.name : (p.logicalName || p.name),
                        rawBaseUrl: rawBaseUrl,
                        remoteDescriptorPath: remoteDescriptorPath,
                        localDescriptorName: (p.localDescriptorName || p.fileName || remoteDescriptorPath).split(/[\\/]/).pop(),
                        frontEndPath: p.frontEndPath,
                        localDir: p.localDir,
                        skipRecursive: skipRecursive
                    })
                });
                const data = await res.json();
                if (data.rateLimit) updateRateLimitDisplay(data.rateLimit);
                if (data.ok) {
                    // The server already persists the downloaded file metadata, so avoid resending the lists.
                    // Construct a detailed summary message for the user
                    const fileList = data.files ? `\n\nDownloaded files:\n- ${data.files.join('\n- ')}` : '';
                    const excludedList = data.skippedBySkipFiles?.length > 0 ? `\n\nExcluded by skipFiles:\n- ${data.skippedBySkipFiles.join('\n- ')}` : '';
                    const skipList = data.notDownloadedFiles?.length > 0 ? `\n\nSkipped files (not downloaded):\n- ${data.notDownloadedFiles.join('\n- ')}` : '';
                    const postUpdateMsg = "\n\nAfter the plugin update, you must:\n1) Clear the browser cache;\n2) Restart the server, if necessary.";
                    const successMessage = commitOverride
                        ? `${p.name} installed from commit ${commitOverride.slice(0, 7)} successfully!`
                        : `${p.name} updated successfully!`;
                    alert(`${successMessage}${postUpdateMsg}${fileList}${excludedList}${skipList}`);
                    await refreshList();
                } else {
                    // Notify user of server-side failure and restore previous status
                    alert(`Update failed: ${data.error || 'Unknown error'}`);
                    if (statusCell) updateStatusCell(p, p.cachedRemoteVer, currentPlugins);
                }
            } catch (e) {
                // Handle network or connection errors
                alert("Connection error during update.");
                if (statusCell) updateStatusCell(p, p.cachedRemoteVer, currentPlugins);
            }
        }

        async function performDelete(p) {
            const isSecondaryBranch = p.branch && p.branch !== 'main';
            let confirmMsg = `Are you sure you want to delete the plugin "${p.name}"?\n\n`;

            if (isSecondaryBranch) {
                confirmMsg += `This will remove only the entry for this branch from the plugin list. Local files will NOT be deleted.`;
            } else {
                confirmMsg += `This will remove:\n- The descriptor file: ${p.fileName}\n- The local directory: ${p.localDir || '(none)'}\n\nTHIS ACTION CANNOT BE UNDONE.`;
            }
            // Add a critical warning if the user is trying to delete the Updater plugin itself
            if (p.name === 'Updater') {
                confirmMsg += `\n\n⚠️ CRITICAL WARNING: You are about to delete the UPDATER plugin itself. This will remove this management interface and the ability to update other plugins!`;
            }
            if (!confirm(confirmMsg)) return;

            // Update the UI status cell to indicate the deletion process has started
            const statusId = `status-${p.name.replace(/\s+/g, '_')}`;
            const statusCell = document.getElementById(statusId);
            if (statusCell) {
                statusCell.innerHTML = '<span style="color: #fe0830; font-weight: bold;">Deleting...</span>';
            }

            try {
                // Send the deletion request to the backend
                const res = await fetch('/plugins/Updater/delete-plugin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pluginName: p.name, // Send the full name as displayed
                        logicalName: p.logicalName || p.name.split(' (')[0], // Send the logical name for backend lookup
                        fileName: p.fileName,
                        localDir: p.localDir
                    })
                });
                const data = await res.json();
                if (data.ok) {
                    // Notify success and refresh the plugin list to reflect changes
                    alert(`${p.name} has been deleted.`);
                    await refreshList();
                } else {
                    // Handle server-side errors and revert the status cell UI
                    alert(`Deletion failed: ${data.error || 'Unknown error'}`);
                    if (statusCell) updateStatusCell(p, p.cachedRemoteVer, currentPlugins);
                }
            } catch (e) {
                // Handle network or connection issues
                alert("Connection error during deletion.");
                if (statusCell) updateStatusCell(p, p.cachedRemoteVer, currentPlugins);
            }
        }

        function openEditModal(p, allPlugins) {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.75); z-index:100000; display:flex; align-items:center; justify-content:center; padding:20px; color:#eee;';

            const modal = document.createElement('div');
            modal.style.cssText = 'background:#161616; padding:26px; border-radius:12px; width:100%; max-width:540px; box-shadow:0 18px 40px rgba(0,0,0,0.6); border:1px solid #00ff00; color:#eee; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size:14px; line-height:1.6;';
            let calculatedBranch = p.branch || 'main';

            modal.innerHTML = `
                    <h3 style="margin:0 0 6px 0; font-size:1.4em; color:#fff;">Edit GitHub Data for <b style="color:#00ff00;">${p.name}</b></h3>
                    <p style="font-size:13px; color:#aaa; margin-top:0; margin-bottom:18px;">Enter the GitHub URL and click Verify to auto-fill details.</p>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold; color:#ccc; margin-bottom:6px;">GitHub Repository URL</label>
                        <div style="display:flex; gap:8px;"><input type="text" id="edit-repo-url" value="${p.repoUrl || (p.githubOwner && p.githubRepo ? `https://github.com/${p.githubOwner}/${p.githubRepo}` : '')}" placeholder="https://github.com/${resolveOwner(p, allPlugins)}/${p.name.replace(/\s+/g, '-')}" style="flex-grow:1; min-width:0; padding:10px 12px; box-sizing:border-box; background:#1c1c1c; border:1px solid #00ff00; border-radius:8px; color:#fff; font-size:14px;"><button id="verify-repo-btn" style="width:40px; height:40px; background:#3fa9f5; border:none; border-radius:8px; cursor:pointer; font-size:14px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#000;" title="Verify repository contents"><i class="fa-solid fa-magnifying-glass"></i></button></div>
                    </div>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold; color:#ccc; margin-bottom:6px;">Descriptor File Path / URL (.js)</label>
                        <input type="text" id="edit-file-path" value="${p.fileUrl || p.githubPath || ''}" placeholder="${p.fileName || p.frontEndPath || 'plugin.js'}" style="width:100%; padding:10px 12px; box-sizing:border-box; background:#1c1c1c; border:1px solid #00ff00; border-radius:8px; color:#fff; font-size:14px;">
                    </div>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold; color:#ccc; margin-bottom:6px;">Local Directory (relative to plugins/)</label>
                        <input type="text" id="edit-local-dir" value="${p.localDir || ''}" placeholder="e.g. MyPluginDir" style="width:100%; padding:10px 12px; box-sizing:border-box; background:#1c1c1c; border:1px solid #00ff00; border-radius:8px; color:#fff; font-size:14px;">
                    </div>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold; color:#ccc; margin-bottom:6px;">Files to skip during update/reinstall</label>
                        <textarea id="edit-skip-files" placeholder="Enter one file name or path per line, e.g. LICENSE or docs/readme.md" style="width:100%; min-height:80px; padding:10px 12px; box-sizing:border-box; background:#1c1c1c; border:1px solid #00ff00; border-radius:8px; color:#fff; font-size:14px; font-family:inherit;">${(p.skipFiles || []).join('\n')}</textarea>
                        <p style="font-size:11px; color:#aaa; margin:6px 0 0;">Separate each file with a new line. Paths are matched against the repository file path and the local relative path.</p>
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:22px;">
                        <button id="cancel-edit" class="updater-btn updater-btn-danger" style="padding:10px 18px; font-size:14px; white-space:nowrap;">Cancel</button>
                        <button id="save-edit" class="updater-btn updater-btn-primary" style="padding:10px 18px; font-size:14px; white-space:nowrap;">Save Settings</button>
                    </div>
                `;

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            // Automatically detect plugin info when the "Verify" button is clicked
            modal.querySelector('#verify-repo-btn').onclick = async () => {
                const repoUrl = modal.querySelector('#edit-repo-url').value.trim();
                const match = repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)(?:\/tree\/([^ \n?#]+))?/);
                if (!match) return alert("Please enter a valid GitHub URL first.");

                const owner = match[1];
                const repo = match[2];
                const urlBranch = match[3];
                const verifyBtn = modal.querySelector('#verify-repo-btn');
                const originalHtml = verifyBtn.innerHTML;

                verifyBtn.disabled = true;
                verifyBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

                let branchList = [];
                try {
                    // Fetch available branches
                    const branchesRes = await fetch(`/plugins/Updater/branches?repoUrl=${encodeURIComponent(repoUrl)}`);
                    if (branchesRes.ok) {
                        branchList = await branchesRes.json();
                    }

                    // Step 1: Check root contents to see if a 'plugins' folder exists
                    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
                    const repoInfo = await repoRes.json();

                    let branch = urlBranch || repoInfo.default_branch || 'main';
                    if ((!urlBranch || urlBranch === repoInfo.default_branch) && branchList.includes('develop')) {
                        branch = 'develop';
                    }

                    calculatedBranch = branch;

                    let contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/?ref=${branch}`;
                    let res = await fetch(contentsUrl);

                    const remaining = res.headers.get('x-ratelimit-remaining');
                    const limit = res.headers.get('x-ratelimit-limit');
                    if (remaining !== null) updateRateLimitDisplay({ remaining, limit });

                    if (!res.ok) throw new Error("Repository not found or API limit reached.");
                    let files = await res.json();

                    // Determine if we should look in the root or in a 'plugins' subdirectory
                    const pluginsDirItem = files.find(f => f.name.toLowerCase() === 'plugins' && f.type === 'dir');

                    if (pluginsDirItem) {
                        // Scenario: Repository has a 'plugins/' folder containing the descriptor and files
                        res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/plugins?ref=${branch}`);
                        if (res.ok) {
                            files = await res.json();
                        }
                    }

                    // Step 2: Search for .js files in the identified directory that might be descriptors
                    const jsFiles = files.filter(f => f.name.endsWith('.js') && f.name !== 'index.js' && !f.name.includes('.frontend.'));
                    let found = false;

                    for (const file of jsFiles) {
                        const rawRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`);
                        if (rawRes.ok) {
                            const text = await rawRes.text();
                            // A descriptor must contain the 'pluginConfig' variable
                            if (text.includes('pluginConfig')) {
                                modal.querySelector('#edit-file-path').value = file.path;
                                const feMatch = text.match(/frontEndPath\s*:\s*['"]([^'"]+)['"]/);
                                modal.querySelector('#edit-local-dir').value = (feMatch && feMatch[1].includes('/')) ? feMatch[1].split('/')[0] : "";
                                found = true;
                                break;
                            }
                        }
                    }
                    if (!found) alert("Could not automatically find a plugin descriptor. Please fill the fields manually.");
                } catch (e) { alert(e.message); } finally {
                    verifyBtn.disabled = false;
                    verifyBtn.innerHTML = originalHtml;
                }
            };

            modal.querySelector('#cancel-edit').onclick = () => overlay.remove();
            modal.querySelector('#save-edit').onclick = async () => {
                const repoUrl = modal.querySelector('#edit-repo-url').value.trim();
                const fileUrl = modal.querySelector('#edit-file-path').value.trim();
                const localDir = modal.querySelector('#edit-local-dir').value.trim();
                const skipFiles = modal.querySelector('#edit-skip-files').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
                const branch = calculatedBranch;
                let targetPluginName = (p.branch && p.branch !== 'main') ? p.name : (p.logicalName || p.name);
                let targetLocalDir = localDir;
                let targetDescriptorName = (p.fileName || fileUrl).split(/[\\/]/).pop();

                try {
                    const res = await fetch('/plugins/Updater/save-override', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            pluginName: targetPluginName,
                            repoUrl: repoUrl,
                            fileUrl: fileUrl,
                            localDir: targetLocalDir,
                            branch: branch,
                            skipFiles,
                            localDescriptorName: targetDescriptorName
                        })
                    });

                    if (res.ok) {
                        const data = await res.json();
                        if (data.rateLimit) updateRateLimitDisplay(data.rateLimit);
                        if (data.ok) {
                            overlay.remove();
                            await refreshList();

                            // Update all plugins from the same author as they might have inherited the new owner
                            allPlugins.forEach(pl => {
                                if (pl.author === p.author) {
                                    const cell = document.getElementById(`status-${pl.name.replace(/\s+/g, '_')}`);
                                    if (cell) cell.innerHTML = '<span style="color: #666; font-style: italic;">Updating...</span>';
                                    delete pl.cachedRemoteVer;
                                    checkUpdate(pl, allPlugins);
                                }
                            });
                        } else {
                            alert("Error saving settings.");
                        }
                    }
                } catch (e) {
                    alert("Connection error.");
                }
            };
        }

        function openAddModal(allPlugins) {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.75); z-index:100000; display:flex; align-items:center; justify-content:center; padding:20px;';

            const modal = document.createElement('div');
            modal.style.cssText = 'background:#161616; padding:26px; border-radius:12px; width:100%; max-width:1040px; box-shadow:0 18px 40px rgba(0,0,0,0.6); border:1px solid #00ff00; color:#eee; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size:15px; line-height:1.7;';

            modal.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid #333; padding-bottom:12px;">
                        <div>
                            <h3 class="updater-title" style="margin:0; font-size:1.5em;">Add New Plugin</h3>
                        </div>
                    </div>
                    <div id="repo-selection-list" style="display:grid; gap:14px; max-height:540px; overflow:auto; padding-right:6px; border:1px solid #00ff00; border-radius:12px; padding:14px;">
                        <div style="background:#1c1c1c; border:1px solid #00ff00; border-radius:10px; padding:18px; color:#ccc; font-size:14px;">Loading known plugins...</div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:18px; gap:12px;">
                        <div style="display:flex; gap:10px;">
                            <button id="disclaimer-btn" class="updater-btn" style="padding:12px 16px; font-size:14px; white-space:nowrap; background:#333; color:#ff6;" title="Important, please read me!">DISCLAIMER</button>
                            <button id="installed-filter-btn" class="updater-btn" style="padding:12px 16px; font-size:14px; white-space:nowrap; background:#333; color:#fff;">Showing: not installed</button>
                            <button id="custom-add-btn" class="updater-btn updater-btn-primary" style="padding:12px 16px; font-size:14px; white-space:nowrap; width:auto; display:inline-flex; align-items:center; justify-content:center;">Add custom plugin</button>
                            <button id="cancel-add" class="updater-btn updater-btn-danger" style="padding:12px 16px; font-size:14px;">Cancel</button>
                        </div>
                    </div>
                `;

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            modal.querySelector('#cancel-add').onclick = () => overlay.remove();
            modal.querySelector('#custom-add-btn').onclick = () => {
                overlay.remove();
                openAddDetailsModal(allPlugins);
            };
            modal.querySelector('#disclaimer-btn').onclick = () => {
                const disclaimerOverlay = document.createElement('div');
                disclaimerOverlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:100001; display:flex; align-items:center; justify-content:center; padding:20px;';
                const disclaimerModal = document.createElement('div');
                disclaimerModal.style.cssText = 'background:#161616; border:1px solid #00ff00; border-radius:12px; width:100%; max-width:680px; padding:26px; color:#eee; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size:14px; line-height:1.6; box-shadow:0 18px 40px rgba(0,0,0,0.6);';
                disclaimerModal.innerHTML = `
                    <h3 style="margin:0 0 16px; color:#fff; font-size:1.4em;">DISCLAIMER</h3>
                    <p>The listed plugins are created and maintained by their respective authors. Install and use them at your own risk.</p>
                    <p>The plugin list is compiled from the <a href="https://discord.com/channels/1053804249651359765/1233159920711368765" target="_blank" rel="noreferrer noopener" style="color:#3fa9f5;">FM-DX Webserver Discord plugin page</a> and the <a href="https://github.com/NoobishSVK/fm-dx-webserver/wiki/Plugin-List" target="_blank" rel="noreferrer noopener" style="color:#3fa9f5;">FM-DX Webserver Plugin List</a>.</p>
                    <p>Report any missing or non-working plugins on the <a href="https://discord.com/channels/1053804249651359765/1233159920711368765/threads/1506667363859173468" target="_blank" rel="noreferrer noopener" style="color:#3fa9f5;">Updater plugin Discord page</a>.</p>
                    <div style="display:flex; justify-content:flex-end; margin-top:22px;">
                        <button id="close-disclaimer-btn" class="updater-btn updater-btn-danger" style="padding:10px 18px; font-size:14px;">Close</button>
                    </div>
                `;
                disclaimerOverlay.appendChild(disclaimerModal);
                document.body.appendChild(disclaimerOverlay);
                disclaimerModal.querySelector('#close-disclaimer-btn').onclick = () => disclaimerOverlay.remove();
                disclaimerOverlay.onclick = (event) => {
                    if (event.target === disclaimerOverlay) disclaimerOverlay.remove();
                };
            };
            let showInstalledPlugins = false;
            const installedFilterBtn = modal.querySelector('#installed-filter-btn');

            fetch('/plugins/Updater/read-file?fileName=' + encodeURIComponent('Updater/repo_data.json'))
                .then(res => res.text())
                .then(text => {
                    try {
                        const repos = JSON.parse(text);
                        const list = modal.querySelector('#repo-selection-list');
                        if (!list) return;

                        const isInstalled = (name, url) => {
                            const normalizedName = name.trim().toLowerCase();
                            const baseName = normalizedName.replace(/\s*\(.+\)$/, '').trim();
                            const normalizedUrl = (url || '').trim().toLowerCase();
                            return allPlugins.some(p => {
                                const names = [p.name || '', p.logicalName || ''].map(v => v.toLowerCase().trim());
                                if (names.includes(normalizedName) || names.includes(baseName)) return true;
                                const repoUrl = (p.repoUrl || '').trim().toLowerCase();
                                if (repoUrl && normalizedUrl && repoUrl === normalizedUrl) return true;
                                return false;
                            });
                        };

                        const parseGithubRepo = (repoUrl) => {
                            const match = repoUrl.match(/github\.com\/([^/]+)\/([^/\s?#]+)/i);
                            return match ? { owner: match[1], repo: match[2] } : null;
                        };

                        const stripMarkdown = (text) => {
                            const cleaned = text
                                .replace(/```[\s\S]*?```/g, ' ')
                                .replace(/`[^`]*`/g, ' ')
                                .replace(/!\[[^\]]*\]\([^\)]+\)/g, ' ')
                                .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
                                .replace(/<[^>]+>/g, ' ')
                                .replace(/[>#*\-_=\[\]~]/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim();
                            return cleaned;
                        };

                        const normalizeReadmeImageUrl = (imgSrc, owner, repo, branch) => {
                            if (!imgSrc) return null;
                            if (/^https?:\/\//i.test(imgSrc)) return imgSrc;
                            if (imgSrc.startsWith('/')) {
                                return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}${imgSrc}`;
                            }
                            return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${imgSrc.replace(/^\.\//, '')}`;
                        };

                        const showImageOverlay = (imageUrl, altText) => {
                            const overlay = document.createElement('div');
                            overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.88); z-index:100001; display:flex; align-items:center; justify-content:center; padding:20px; cursor:pointer;';
                            const img = document.createElement('img');
                            img.src = imageUrl;
                            img.alt = altText;
                            img.title = 'Click again to go back';
                            img.style.cssText = 'max-width:90%; max-height:90%; border-radius:12px; box-shadow:0 18px 40px rgba(0,0,0,0.6);';
                            overlay.appendChild(img);
                            overlay.onclick = () => overlay.remove();
                            document.body.appendChild(overlay);
                        };

                        const loadReadmePreview = async (repoUrl, textElement, imageElement, pluginName) => {
                            const repoInfo = parseGithubRepo(repoUrl);
                            if (!repoInfo) {
                                textElement.textContent = 'README preview unavailable.';
                                return;
                            }

                            const tryRawReadme = async () => {
                                const branches = ['HEAD', 'main', 'master'];
                                const names = ['README.md', 'README.MD', 'README.markdown', 'README.txt', 'readme.md'];
                                for (const branch of branches) {
                                    for (const name of names) {
                                        const rawUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${branch}/${name}`;
                                        const res = await fetch(rawUrl);
                                        if (res.ok) {
                                            const text = await res.text();
                                            let resolvedBranch = branch;
                                            if (res.url) {
                                                const match = res.url.match(new RegExp(`https://raw\.githubusercontent\.com/${repoInfo.owner}/${repoInfo.repo}/(.+)/${name.replace(/\./g, '\\.')}$`));
                                                if (match && match[1]) {
                                                    resolvedBranch = match[1];
                                                    if (resolvedBranch.startsWith('refs/heads/')) {
                                                        const parts = resolvedBranch.split('/');
                                                        resolvedBranch = parts[parts.length - 1] || resolvedBranch;
                                                    }
                                                }
                                            }
                                            return { text, branch: resolvedBranch };
                                        }
                                    }
                                }
                                return null;
                            };

                            try {
                                const readmeData = await tryRawReadme();
                                if (!readmeData || !readmeData.text) throw new Error('No README');

                                const decoded = readmeData.text;
                                const firstImageMatch = decoded.match(/!\[[^\]]*\]\(([^\)]+)\)/);
                                const firstHtmlImageMatch = decoded.match(/<img[^>]+src=["']([^"']+)["']/i);
                                let previewText = stripMarkdown(decoded);
                                if (!previewText) previewText = 'README preview unavailable.';
                                if (previewText.length > 220) previewText = previewText.slice(0, 220).trim() + '...';

                                textElement.textContent = previewText;
                                const imageSrc = (firstImageMatch && firstImageMatch[1]) || (firstHtmlImageMatch && firstHtmlImageMatch[1]);
                                if (imageSrc) {
                                    const imageUrl = normalizeReadmeImageUrl(imageSrc, repoInfo.owner, repoInfo.repo, readmeData.branch);
                                    const altText = pluginName ? `${pluginName} preview` : `${repoInfo.repo} preview`;
                                    imageElement.innerHTML = `
                                        <div style="position:relative; width:100%; height:100%; cursor:pointer; overflow:hidden; border-radius:10px;" title="Click to Enlarge">
                                            <img src="${imageUrl}" alt="${altText}" title="Click to Enlarge" style="width:100%; height:100%; object-fit:cover; display:block;">
                                            <div style="position:absolute; inset:0; background:rgba(0,0,0,0.12); display:flex; align-items:center; justify-content:center;">
                                                <span style="font-size:22px; color:#fff; text-shadow:0 0 10px rgba(0,0,0,0.5);">🔍</span>
                                            </div>
                                        </div>
                                    `;
                                    const clickArea = imageElement.firstElementChild;
                                    if (clickArea) {
                                        clickArea.onclick = (event) => {
                                            event.stopPropagation();
                                            showImageOverlay(imageUrl, altText);
                                        };
                                    }
                                }
                            } catch (e) {
                                textElement.textContent = 'README preview unavailable.';
                            }
                        };

                        const entries = Object.entries(repos).sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
                        const renderRepositoryList = () => {
                            const visibleEntries = showInstalledPlugins
                                ? entries
                                : entries.filter(([name, url]) => !isInstalled(name, url));
                            installedFilterBtn.textContent = showInstalledPlugins
                                ? `Showing: all plugins (${visibleEntries.length})`
                                : `Showing: not installed (${visibleEntries.length})`;
                            installedFilterBtn.title = showInstalledPlugins ? 'Click to show only plugins that are not installed' : 'Click to show all known plugins, including installed ones';
                            list.innerHTML = '';

                            if (visibleEntries.length === 0) {
                                list.innerHTML = `<div style="background:#1c1c1c; border:1px solid #2d2d2d; border-radius:8px; padding:16px; color:#ccc;">All known plugins are already installed.</div>`;
                                return;
                            }

                            visibleEntries.forEach(([name, url]) => {
                                const pluginAlreadyInstalled = isInstalled(name, url);
                                const item = document.createElement('div');
                                item.style.cssText = 'display:flex; justify-content:flex-start; align-items:flex-start; gap:18px; padding:18px 20px; border:1px solid #2f4a2f; border-radius:10px; background:#1f1f1f;';
                                item.innerHTML = `
                                    <div style="flex:0 0 180px; max-width:180px; display:flex; align-items:center; justify-content:center;">
                                        <div class="repo-preview-image" style="width:180px; height:140px; border-radius:10px; overflow:hidden; background:#121212; display:flex; align-items:center; justify-content:center;"></div>
                                    </div>
                                    <div style="min-width:0; flex:1; display:flex; flex-direction:column; gap:10px;">
                                        <div>
                                            <div style="font-size:16px; font-weight:700; color:#fff; margin-bottom:6px;">${name}</div>
                                            <div style="font-size:13px; color:#ddd; word-break:break-all;"><a href="${url}" target="_blank" rel="noreferrer noopener" style="color:#8ab9ff; text-decoration:underline;">${url}</a></div>
                                        </div>
                                        <div class="repo-preview-text" style="font-size:14px; color:#ccc; margin-top:4px; line-height:1.6;">Loading README preview...</div>
                                    </div>
                                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:12px; width:150px;">
                                        <button class="updater-btn ${pluginAlreadyInstalled ? '' : 'updater-btn-primary'}" ${pluginAlreadyInstalled ? 'disabled' : ''} style="padding:10px 14px; white-space:nowrap; font-size:14px; ${pluginAlreadyInstalled ? 'background:#555; color:#bbb; cursor:not-allowed; opacity:0.75;' : ''}" title="${pluginAlreadyInstalled ? 'This plugin is already installed' : 'Select this plugin'}">${pluginAlreadyInstalled ? 'Already installed' : 'Select'}</button>
                                    </div>
                                `;
                                const button = item.querySelector('button');
                                const previewText = item.querySelector('.repo-preview-text');
                                const previewImage = item.querySelector('.repo-preview-image');
                                if (button && !pluginAlreadyInstalled) {
                                    button.onclick = () => {
                                        overlay.remove();
                                        openAddDetailsModal(allPlugins, url, name);
                                    };
                                }
                                list.appendChild(item);
                                loadReadmePreview(url, previewText, previewImage, name);
                            });
                        };

                        installedFilterBtn.onclick = () => {
                            showInstalledPlugins = !showInstalledPlugins;
                            renderRepositoryList();
                        };

                        if (entries.length === 0) {
                            list.innerHTML = `<div style="background:#1c1c1c; border:1px solid #2d2d2d; border-radius:8px; padding:16px; color:#ccc;">No known plugins found in repo_data.json.</div>`;
                        } else {
                            renderRepositoryList();
                        }
                    } catch (e) {
                        const list = modal.querySelector('#repo-selection-list');
                        if (list) list.innerHTML = `<div style="background:#1c1c1c; border:1px solid #2d2d2d; border-radius:8px; padding:16px; color:#f88;">Unable to load known plugins.</div>`;
                    }
                })
                .catch(() => {
                    const list = modal.querySelector('#repo-selection-list');
                    if (list) list.innerHTML = `<div style="background:#1c1c1c; border:1px solid #2d2d2d; border-radius:8px; padding:16px; color:#f88;">Unable to load known plugins.</div>`;
                });
        }

        function openAddDetailsModal(allPlugins, initialRepoUrl = '', initialPluginName = '') {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.75); z-index:100000; display:flex; align-items:center; justify-content:center; padding:20px; color:#eee;';

            const modal = document.createElement('div');
            modal.style.cssText = 'background:#161616; padding:26px; border-radius:12px; width:100%; max-width:540px; box-shadow:0 18px 40px rgba(0,0,0,0.6); border:1px solid #00ff00; color:#eee; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size:14px; line-height:1.6;';
            let calculatedBranch = 'main';

            modal.innerHTML = `
                    <h3 style="margin:0 0 6px 0; font-size:1.4em; color:#fff;">Add New Plugin</h3>
                    <p style="font-size:13px; color:#aaa; margin-top:0; margin-bottom:18px;">Enter the repository details for the plugin you want to install or just click on the lens icon to try to auto-detect the data.</p>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold; color:#ccc; margin-bottom:6px;">GitHub Repository URL</label>
                        <div style="display:flex; gap:8px;"><input type="text" id="add-repo-url" value="${initialRepoUrl}" placeholder="https://github.com/mm-prg/FavStations" style="flex-grow:1; min-width:0; padding:10px 12px; box-sizing:border-box; background:#1c1c1c; border:1px solid #00ff00; border-radius:8px; color:#fff; font-size:14px;"><button id="verify-repo-btn" style="width:40px; height:40px; background:#3fa9f5; border:none; border-radius:8px; cursor:pointer; font-size:14px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#000;" title="Verify repository contents"><i class="fa-solid fa-magnifying-glass"></i></button></div>
                    </div>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold; color:#ccc; margin-bottom:6px;">Descriptor File Path / URL (.js)</label>
                        <input type="text" id="add-file-path" placeholder="e.g. FavStations.js or Folder/Plugin.js" style="width:100%; padding:10px 12px; box-sizing:border-box; background:#1c1c1c; border:1px solid #00ff00; border-radius:8px; color:#fff; font-size:14px;">
                    </div>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold; color:#ccc; margin-bottom:6px;">Local Directory (relative to plugins/)</label>
                        <input type="text" id="add-local-dir" placeholder="e.g. FavStations" style="width:100%; padding:10px 12px; box-sizing:border-box; background:#1c1c1c; border:1px solid #00ff00; border-radius:8px; color:#fff; font-size:14px;">
                    </div>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold; color:#ccc; margin-bottom:6px;">Files to skip during update/reinstall</label>
                        <textarea id="add-skip-files" placeholder="Enter one file name or path per line, e.g. LICENSE or docs/readme.md" style="width:100%; min-height:90px; padding:10px 12px; box-sizing:border-box; background:#1c1c1c; border:1px solid #00ff00; border-radius:8px; color:#fff; font-size:14px; font-family:inherit;"></textarea>
                        <p style="font-size:11px; color:#aaa; margin:6px 0 0;">Separate each file with a new line. Paths are matched against the repository file path and the local relative path.</p>
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:22px;">
                        <button id="cancel-add" class="updater-btn updater-btn-danger" style="padding:10px 18px; font-size:14px; white-space:nowrap;">Cancel</button>
                        <button id="save-add" class="updater-btn updater-btn-primary" style="padding:10px 18px; font-size:14px; white-space:nowrap;">Save & Install</button>
                    </div>
                `;

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            modal.querySelector('#cancel-add').onclick = () => overlay.remove();

            modal.querySelector('#verify-repo-btn').onclick = async () => {
                const repoUrl = modal.querySelector('#add-repo-url').value.trim();
                const match = repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)(?:\/tree\/([^ \n?#]+))?/);
                if (!match) return alert("Please enter a valid GitHub URL first.");

                const owner = match[1];
                const repo = match[2];
                const urlBranch = match[3];
                const verifyBtn = modal.querySelector('#verify-repo-btn');
                const originalHtml = verifyBtn.innerHTML;

                verifyBtn.disabled = true;
                verifyBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

                let branchList = [];
                try {
                    const branchesRes = await fetch(`/plugins/Updater/branches?repoUrl=${encodeURIComponent(repoUrl)}`);
                    if (branchesRes.ok) {
                        branchList = await branchesRes.json();
                    }

                    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
                    const repoInfo = await repoRes.json();

                    let branch = urlBranch || repoInfo.default_branch || 'main';
                    if ((!urlBranch || urlBranch === repoInfo.default_branch) && branchList.includes('develop')) {
                        branch = 'develop';
                    }

                    calculatedBranch = branch;

                    let contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/?ref=${branch}`;
                    let res = await fetch(contentsUrl);

                    const remaining = res.headers.get('x-ratelimit-remaining');
                    const limit = res.headers.get('x-ratelimit-limit');
                    const reset = res.headers.get('x-ratelimit-reset');
                    if (remaining !== null) updateRateLimitDisplay({ remaining, limit, reset });

                    if (!res.ok) {
                        if (res.status === 403) {
                            let msg = "GitHub API rate limit exceeded.";
                            if (reset) {
                                const minutes = Math.ceil((parseInt(reset) * 1000 - Date.now()) / 60000);
                                msg += `\n\nPlease wait about ${minutes} minute(s) before trying again.`;
                            }
                            throw new Error(msg);
                        }
                        if (res.status === 404) throw new Error("Repository not found. Please verify the owner and repository name.");
                        throw new Error(`GitHub API Error: ${res.status} ${res.statusText}`);
                    }

                    let files = await res.json();
                    const pluginsDirItem = files.find(f => f.name.toLowerCase() === 'plugins' && f.type === 'dir');
                    if (pluginsDirItem) {
                        res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/plugins?ref=${branch}`);
                        if (res.ok) {
                            files = await res.json();
                        }
                    }

                    const jsFiles = files.filter(f => f.name.endsWith('.js') && f.name !== 'index.js' && !f.name.includes('.frontend.'));
                    let found = false;
                    for (const file of jsFiles) {
                        const rawRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`);
                        if (rawRes.ok) {
                            const text = await rawRes.text();
                            if (text.includes('pluginConfig')) {
                                modal.querySelector('#add-file-path').value = file.path;
                                const feMatch = text.match(/frontEndPath\s*:\s*['"]([^'"]+)['"]/);
                                let suggestedDir = (feMatch && feMatch[1].includes('/')) ? feMatch[1].split('/')[0] : "";
                                modal.querySelector('#add-local-dir').value = suggestedDir;
                                found = true;
                                break;
                            }
                        }
                    }
                    if (!found) alert("Could not automatically find a plugin descriptor. Please fill the fields manually.");
                } catch (e) { alert(e.message); } finally {
                    verifyBtn.disabled = false;
                    verifyBtn.innerHTML = originalHtml;
                }
            };

            modal.querySelector('#save-add').onclick = async () => {
                const repoUrl = modal.querySelector('#add-repo-url').value.trim();
                const manualFilePath = modal.querySelector('#add-file-path').value.trim();
                const localDir = modal.querySelector('#add-local-dir').value.trim();
                const skipFiles = modal.querySelector('#add-skip-files').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
                const branch = calculatedBranch;

                if (!repoUrl || !manualFilePath || !localDir) {
                    return alert("All three fields are required. Click on the lens icon to try to auto-detect the data.");
                }

                const match = repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)(?:\/tree\/([^ \n?#]+))?/);
                if (!match) return alert("Invalid GitHub URL. Use: https://github.com/owner/repository");

                const owner = match[1];
                const repo = match[2];

                const saveBtn = modal.querySelector('#save-add');
                saveBtn.disabled = true;
                saveBtn.textContent = "Verifying...";

                let descriptorText = "";
                const foundFileUrl = manualFilePath;
                const testUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${foundFileUrl}`;
                try {
                    const res = await fetch(testUrl);
                    if (res.ok) {
                        descriptorText = await res.text();
                    }
                } catch (e) {
                    console.error("Error fetching descriptor:", e);
                }

                if (!descriptorText) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = "Save & Install";
                    return alert("Could not find the descriptor file at the specified path in the repository.");
                }

                let skipRecursive = false;
                const nameMatch = descriptorText.match(/name\s*:\s*['"]([^'"]+)['"]/);
                const fePathMatch = descriptorText.match(/frontEndPath\s*:\s*['"]([^'"]+)['"]/);
                const originalPluginName = nameMatch ? nameMatch[1] : repo;
                const fePath = fePathMatch ? fePathMatch[1] : "";
                const descriptorFileName = foundFileUrl.split('/').pop();
                let targetPluginName = originalPluginName;
                let targetLocalDir = localDir;
                let targetDescriptorName = descriptorFileName;
                const hasTree = repoUrl.includes('/tree/');
                if (hasTree && branch && branch !== 'main') {
                    try {
                        const mainRepoUrl = repoUrl.split('/tree/')[0];
                        await fetch('/plugins/Updater/save-override', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                pluginName: originalPluginName,
                                repoUrl: mainRepoUrl,
                                fileUrl: foundFileUrl,
                                localDir: targetLocalDir,
                                branch: 'main',
                                skipFiles,
                                localDescriptorName: targetDescriptorName
                            })
                        });
                        targetPluginName = `${originalPluginName} (${branch})`;
                    } catch (e) { console.error("[Updater] Error creating main entry:", e); }
                }

                try {
                    const res = await fetch('/plugins/Updater/save-override', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            pluginName: targetPluginName,
                            logicalName: originalPluginName,
                            repoUrl: repoUrl,
                            fileUrl: foundFileUrl,
                            localDir: targetLocalDir,
                            branch: branch,
                            skipFiles,
                            localDescriptorName: targetDescriptorName
                        })
                    });

                    const data = await res.json();
                    if (data.rateLimit) updateRateLimitDisplay(data.rateLimit);
                    if (data.ok) {
                        saveBtn.textContent = "Downloading files...";
                        const updateRes = await fetch('/plugins/Updater/update-plugin', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                pluginName: targetPluginName,
                                rawBaseUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`,
                                remoteDescriptorPath: foundFileUrl,
                                localDescriptorName: targetDescriptorName,
                                frontEndPath: fePath,
                                localDir: targetLocalDir,
                                skipRecursive: skipRecursive
                            })
                        });

                        const updateData = await updateRes.json();
                        if (updateData.rateLimit) updateRateLimitDisplay(updateData.rateLimit);
                        if (updateData.rateLimit) updateRateLimitDisplay(updateData.rateLimit);
                        overlay.remove();
                        const fileList = updateData.files ? `\n\nDownloaded files:\n- ${updateData.files.join('\n- ')}` : '';
                        const excludedList = updateData.skippedBySkipFiles?.length > 0 ? `\n\nExcluded by skipFiles:\n- ${updateData.skippedBySkipFiles.join('\n- ')}` : '';
                        const skipList = updateData.notDownloadedFiles?.length > 0 ? `\n\nSkipped files (not downloaded):\n- ${updateData.notDownloadedFiles.join('\n- ')}` : '';
                        const postInstallMsg = "\n\nAfter loading a new plugin, you must also:\n1) In the fm-dx-webserver setup plugins page, activate the plugin;\n2) Save the new configuration;\n3) Clear the browser cache;\n4) Restart the server, if necessary.";
                        alert(`Plugin "${targetPluginName}" added and installed successfully!${postInstallMsg}${fileList}${excludedList}${skipList}`);
                        await refreshList();
                    } else {
                        alert("Error saving plugin.");
                    }
                } catch (e) {
                    alert("Connection error.");
                } finally {
                    saveBtn.disabled = false;
                    saveBtn.textContent = "Save & Install";
                }
            };
        }

        async function toggleOptionsDropdown(event) {
            const existing = document.getElementById('updater-options-dropdown');
            if (existing) {
                existing.remove();
                return;
            }
            event.stopPropagation();
            const btn = event.currentTarget;
            const rect = btn.getBoundingClientRect();
            const dropdown = document.createElement('div');
            dropdown.id = 'updater-options-dropdown';
            dropdown.style.cssText = `position:fixed; top:${rect.bottom + 5}px; left:${rect.left}px; background:#1a1a1a; border:1px solid #444; border-radius:4px; padding:12px; z-index:100002; width:260px; box-shadow:0 4px 20px rgba(0,0,0,0.8); color:#fff; font-size:13px;`;
            dropdown.innerHTML = `
                    <div style="margin-bottom:12px; border-bottom:1px solid #333; padding-bottom:8px; font-weight:bold; color:#00ff00; font-size:11px; text-transform:uppercase;">Visibility</div>
                    <div style="margin-bottom:15px;">
                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;"><input type="checkbox" id="opt-show-panel" ${settings.showInPluginPanel ? 'checked' : ''}> Plugin Panel</label>
                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;"><input type="checkbox" id="opt-show-header" ${settings.showInHeader ? 'checked' : ''}> Header Button</label>
                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;"><input type="checkbox" id="opt-show-setup" ${settings.showInSetup ? 'checked' : ''}> Setup Table</label>
                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;"><input type="checkbox" id="opt-show-server-description" ${settings.showInServerDescription ? 'checked' : ''}> Extra Plugin Bar</label>
                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer; color:#ffaa00;"><input type="checkbox" id="opt-advanced-mode" ${settings.advancedMode ? 'checked' : ''}> Advanced Mode (Explore Files)</label>
                    </div>
                    <div style="margin-bottom:12px; border-bottom:1px solid #333; padding-bottom:8px; font-weight:bold; color:#3fa9f5; font-size:11px; text-transform:uppercase;">Linux Terminal</div>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:11px; margin-bottom:5px; color:#aaa;">Sudo Password (optional):</label>
                        <input type="password" id="opt-sudo-pass" value="${settings.sudoPassword || ''}" style="width:100%; padding:6px; background:#333; border:1px solid #444; color:#fff; border-radius:4px; font-size:12px;">
                    </div>
                    <button id="opt-save" style="width:100%; padding:6px; border:none; background:#fe0830; color:#fff; cursor:pointer; border-radius:4px; font-size:11px; font-weight:bold; margin-bottom:15px;">SAVE SETTINGS</button>
                `;
            document.body.appendChild(dropdown);
            const dRect = dropdown.getBoundingClientRect();
            if (dRect.right > window.innerWidth) dropdown.style.left = (window.innerWidth - dRect.width - 10) + 'px';
            const closeDropdown = (e) => {
                if (!dropdown.contains(e.target) && e.target !== btn) {
                    dropdown.remove();
                    document.removeEventListener('click', closeDropdown);
                }
            };
            setTimeout(() => document.addEventListener('click', closeDropdown), 0);
            dropdown.querySelector('#opt-save').onclick = async () => {
                const newSettings = {
                    ...settings,
                    showInPluginPanel: dropdown.querySelector('#opt-show-panel').checked,
                    showInHeader: dropdown.querySelector('#opt-show-header').checked,
                    showInSetup: dropdown.querySelector('#opt-show-setup').checked,
                    showInServerDescription: dropdown.querySelector('#opt-show-server-description').checked,
                    advancedMode: dropdown.querySelector('#opt-advanced-mode').checked,
                    sudoPassword: dropdown.querySelector('#opt-sudo-pass').value
                };
                try {
                    const res = await fetch('/plugins/Updater/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(newSettings)
                    });
                    if (res.ok) {
                        dropdown.remove();
                        alert("Settings saved");
                        location.reload();
                    }
                } catch (e) { alert("Error saving settings."); }
            };
        }

        async function toggleConfigFilesDropdown(event) {
            const existing = document.getElementById('updater-config-files-dropdown');
            if (existing) {
                existing.remove();
                return;
            }
            event.stopPropagation();
            const btn = event.currentTarget;
            const rect = btn.getBoundingClientRect();

            const customButtons = settings.customButtons;

            const dropdown = document.createElement('div');
            dropdown.id = 'updater-config-files-dropdown';
            dropdown.style.cssText = `position:fixed; top:${rect.bottom + 5}px; left:${rect.left}px; background:#1a1a1a; border:1px solid #444; border-radius:4px; padding:12px; z-index:100002; width:260px; box-shadow:0 4px 20px rgba(0,0,0,0.8); color:#fff; font-size:13px;`;
            dropdown.innerHTML = `
                    <div style="margin-bottom:8px; font-weight:bold; color:#ffaa00; font-size:11px; text-transform:uppercase;">Advanced Tools</div>
                    <button id="view-server-config-btn" title="Edit Fm-Dx-Webserver configuration file" style="background:#333; color:#fff; border:1px solid #444; border-radius:4px; padding:6px; cursor:pointer; font-size:11px; width:100%; margin-bottom:5px; text-align:left;">Fm-Dx-Webserver Configuration</button>
                    <button id="opt-view-log" title="View server console log (serverlog.txt)" style="background:#333; color:#fff; border:1px solid #444; border-radius:4px; padding:6px; cursor:pointer; font-size:11px; width:100%; margin-bottom:5px; text-align:left;">View Server Log</button>
                    <button id="menu-cache-btn" title="View modules currently loaded in the Node.js memory" style="background:#333; color:#fff; border:1px solid #444; border-radius:4px; padding:6px; cursor:pointer; font-size:11px; width:100%; margin-bottom:5px; text-align:left;">View Node.js Cache</button>
                    <button id="menu-terminal-btn" title="Execute system commands" style="background:#333; color:#fff; border:1px solid #444; border-radius:4px; padding:6px; cursor:pointer; font-size:11px; width:100%; margin-bottom:5px; text-align:left;">Execute Terminal Commands</button>
                    <button id="menu-custom-1-btn" title="Execute: ${customButtons[0].cmd || 'Not set'}" style="background:#333; color:#fff; border:1px solid #444; border-radius:4px; padding:6px; cursor:pointer; font-size:11px; width:100%; margin-bottom:5px; text-align:left;"><i class="fa-solid fa-terminal" style="font-size:10px; color:#ffaa00; margin-right:5px;"></i> ${customButtons[0].label}</button>
                    <button id="menu-custom-2-btn" title="Execute: ${customButtons[1].cmd || 'Not set'}" style="background:#333; color:#fff; border:1px solid #444; border-radius:4px; padding:6px; cursor:pointer; font-size:11px; width:100%; margin-bottom:5px; text-align:left;"><i class="fa-solid fa-terminal" style="font-size:10px; color:#ffaa00; margin-right:5px;"></i> ${customButtons[1].label}</button>

                    <div style="margin:12px 0 8px 0; border-top:1px solid #333; padding-top:12px; font-weight:bold; color:#00ccff; font-size:11px; text-transform:uppercase;">Plugins data</div>
                    <button id="view-new-data-btn" title="Local plugins metadata" style="background:#333; color:#fff; border:1px solid #444; border-radius:4px; padding:6px; cursor:pointer; font-size:11px; width:100%; margin-bottom:5px; text-align:left;">plugins_data.json</button>
                    <button id="view-repo-data-btn" title="Database of known plugin repositories" style="background:#333; color:#fff; border:1px solid #444; border-radius:4px; padding:6px; cursor:pointer; font-size:11px; width:100%; text-align:left;">repo_data.json</button>
                `;
            document.body.appendChild(dropdown);
            const dRect = dropdown.getBoundingClientRect();
            if (dRect.right > window.innerWidth) dropdown.style.left = (window.innerWidth - dRect.width - 10) + 'px';
            const closeDropdown = (e) => {
                if (!dropdown.contains(e.target) && e.target !== btn) {
                    dropdown.remove();
                    document.removeEventListener('click', closeDropdown);
                }
            };
            setTimeout(() => document.addEventListener('click', closeDropdown), 0);

            dropdown.querySelector('#view-new-data-btn').onclick = async () => {
                try {
                    const res = await fetch(`/plugins/Updater/read-file?fileName=${encodeURIComponent('Updater/plugins_data.json')}`);
                    if (!res.ok) throw new Error();
                    openViewFileModal('plugins_data.json', await res.text());
                    dropdown.remove();
                } catch (e) { alert("Error reading file."); }
            };
            dropdown.querySelector('#view-repo-data-btn').onclick = async () => {
                try {
                    const res = await fetch(`/plugins/Updater/read-file?fileName=${encodeURIComponent('Updater/repo_data.json')}`);
                    if (!res.ok) throw new Error();
                    openViewFileModal('repo_data.json', await res.text());
                    dropdown.remove();
                } catch (e) { alert("Error reading file."); }
            };
            dropdown.querySelector('#view-server-config-btn').onclick = async () => {
                dropdown.remove();
                try {
                    const res = await fetch(`/plugins/Updater/read-file?fileName=config.json&root=server&t=${Date.now()}`);
                    if (!res.ok) throw new Error();
                    const text = await res.text();
                    openViewFileModal('config.json', text, [], [], 'config.json', '', '', 'server');
                } catch (e) { alert("Error reading server config.json."); }
            };
            dropdown.querySelector('#opt-view-log').onclick = async () => {
                dropdown.remove();
                try {
                    const res = await fetch(`/plugins/Updater/read-file?fileName=serverlog.txt&root=server&t=${Date.now()}`);
                    if (!res.ok) throw new Error();
                    const text = await res.text();
                    openViewFileModal('serverlog.txt', text, [], [], 'serverlog.txt', '', '', 'server', '', '', true);
                } catch (e) { alert("Error reading server log. File may not exist."); }
            };
            dropdown.querySelector('#menu-terminal-btn').onclick = () => {
                openTerminalModal();
                dropdown.remove();
            };
            dropdown.querySelector('#menu-custom-1-btn').onclick = () => {
                openTerminalModal(customButtons[0].cmd);
                dropdown.remove();
            };
            dropdown.querySelector('#menu-custom-2-btn').onclick = () => {
                openTerminalModal(customButtons[1].cmd);
                dropdown.remove();
            };
            dropdown.querySelector('#menu-cache-btn').onclick = async () => {
                try {
                    const res = await fetch('/plugins/Updater/debug-cache?t=' + Date.now());
                    if (!res.ok) throw new Error();
                    const data = await res.json();
                    const cachePaths = (data.details || []).map(item => item.path).sort();
                    const content = (data.serverStartTime ? `Server started: ${data.serverStartTime}\n\n` : '') + cachePaths.join('\n');
                    openViewFileModal('Node_Cache.txt', content, [], [], 'Internal Memory', '', '', 'server', '', '', true);
                    dropdown.remove();
                } catch (e) {
                    alert("Error fetching Node.js cache info.");
                }
            };
        }

        function openViewFileModal(fileName, content, downloadedFiles = [], notDownloadedFiles = [], fullPath = '', repoUrl = '', descriptorUrl = '', initialRoot = 'plugins', localDir = '', logicalName = '', forceReadOnly = false) {
            const textExtensions = ['.js', '.json', '.css', '.html', '.txt', '.md', '.py', '.sh', '.xml', '.yaml', '.yml', '.ini', '.conf', '.log'];
            const isTextFile = (name) => textExtensions.some(ext => name.toLowerCase().endsWith(ext));
            const isEditableFile = (name, root) => {
                if (forceReadOnly) return false;
                if (!name) return false;
                if (root === 'server' && name !== 'config.json') return false; // Only config.json is editable in server root
                if (root === 'cache') return false; // Cache files are read-only
                return isTextFile(name); // Must be a text file
            };
            const isDeletableFile = (name, root) => isEditableFile(name, root) && name !== 'config.json' && root !== 'cache';

            const isSidebarHidden = (root) => root === 'server';
            let originalContent = content || '';

            const localFilenames = new Set();

            let currentExplorerPath = '';
            let currentRoot = initialRoot || 'plugins';
            const getLocalPath = (p) => p.startsWith('plugins/') ? p.substring(8) : p;

            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:100000; display:flex; align-items:center; justify-content:center; color:#eee;';

            const modal = document.createElement('div');
            modal.style.cssText = 'background:#161616; padding:20px; border:1px solid #00ff00; border-radius:12px; width:95%; max-width:1200px; height:90vh; display:flex; flex-direction:column; box-shadow:0 18px 40px rgba(0,0,0,0.6); color:#eee;';

            const rootLabel = initialRoot === 'configs' ? 'configs' : (initialRoot === 'server' ? 'server' : (initialRoot === 'cache' ? 'Node.js Cache' : 'plugins'));
            const header = document.createElement('div');
            header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #333; padding-bottom:8px;';
            header.insertAdjacentHTML('beforeend', `<h3 style="margin:0;"><i class="fa-solid fa-magnifying-glass" style="color:#3fa9f5;"></i> Explore [${rootLabel}]: <span class="sc-view-filename" style="color:#3fa9f5;">${fileName || 'Select a file'}</span></h3>`);

            const closeBtn = document.createElement('button');
            closeBtn.textContent = '×';
            closeBtn.style.cssText = 'background:none; border:none; padding:0; cursor:pointer; font-weight:bold; font-size:24px; line-height:1; width:auto; color:#fff;';
            closeBtn.onclick = () => overlay.remove();
            header.appendChild(closeBtn);
            modal.appendChild(header);

            const mainArea = document.createElement('div');
            mainArea.style.cssText = 'display:flex; flex-grow:1; gap:20px; overflow:hidden;';
            modal.appendChild(mainArea);

            const sidebar = document.createElement('div');
            const hideSidebar = isSidebarHidden(initialRoot);
            sidebar.style.cssText = `flex: 0 0 300px; display:${hideSidebar ? 'none' : 'flex'}; flex-direction:column; border-right:1px solid #333; padding-right:15px; overflow-y:auto;`;
            mainArea.appendChild(sidebar);

            const editorArea = document.createElement('div');
            editorArea.style.cssText = 'flex-grow:1; display:flex; flex-direction:column; overflow:hidden;';
            mainArea.appendChild(editorArea);

            const filterContainer = document.createElement('div');
            const showToolbar = fileName && (isTextFile(fileName) || forceReadOnly);
            filterContainer.style.cssText = `margin-bottom: 10px; display: ${showToolbar ? 'flex' : 'none'}; align-items: center; gap: 15px; background: #1c1c1c; padding: 8px; border-radius: 4px; border: 1px solid #333;`;
            filterContainer.innerHTML = `
                    <div id="log-filter-section" style="display: ${forceReadOnly ? 'flex' : 'none'}; align-items: center; gap: 10px; flex-grow: 1;">
                        <i class="fa-solid fa-filter" style="color: #3fa9f5;"></i>
                        <span style="font-size: 12px; font-weight: bold; color: #ccc;">Fast Filter:</span>
                        <input type="text" id="log-filter-input" placeholder="Type to filter lines (e.g. Updater)..." style="flex-grow: 1; padding: 6px; border: 1px solid #444; border-radius: 4px; font-size: 12px; outline: none; background: #111; color: #eee;">
                        <span id="log-filter-count" style="font-size: 11px; color: #aaa; white-space: nowrap;"></span>
                    </div>
                    <label style="display: flex; align-items: center; gap: 5px; cursor: pointer; font-size: 12px; font-weight: bold; color: #ccc; white-space: nowrap; user-select: none;">
                        <input type="checkbox" id="word-wrap-toggle"> Word Wrap
                    </label>
                `;
            editorArea.appendChild(filterContainer);

            const filterSection = filterContainer.querySelector('#log-filter-section');
            const filterInput = filterContainer.querySelector('#log-filter-input');
            const filterCount = filterContainer.querySelector('#log-filter-count');
            const wrapToggle = filterContainer.querySelector('#word-wrap-toggle');

            wrapToggle.onchange = () => {
                const isWrapped = wrapToggle.checked;
                codeArea.style.whiteSpace = isWrapped ? 'pre-wrap' : 'pre';
                lineNumbers.style.display = isWrapped ? 'none' : 'block';
            };

            if (forceReadOnly) {
                const total = originalContent ? originalContent.split('\n').length : 0;
                filterCount.textContent = `Total lines: ${total}`;
            }

            const codeWrapper = document.createElement('div');
            codeWrapper.style.cssText = 'flex-grow:1; display:flex; overflow:hidden; border:1px solid #333; border-radius:4px; background:#111;';
            editorArea.appendChild(codeWrapper);

            const lineNumbers = document.createElement('div');
            lineNumbers.style.cssText = 'padding:10px 8px; background:#1c1c1c; border-right:1px solid #333; color:#888; text-align:right; font-family:monospace; font-size:12px; line-height:1.5; user-select:none; min-width:35px; overflow:hidden; white-space:pre;';
            codeWrapper.appendChild(lineNumbers);

            const codeArea = document.createElement('textarea');
            codeArea.readOnly = true; // Default to read-only
            codeArea.style.cssText = 'flex-grow:1; border:none; padding:10px; font-family:monospace; font-size:12px; line-height:1.5; white-space:pre; overflow:auto; background:transparent; resize:none; color:#eee; outline:none;';
            codeWrapper.appendChild(codeArea);

            codeArea.onscroll = () => { lineNumbers.scrollTop = codeArea.scrollTop; };

            const setEditorValue = (text, updateTextarea = true, customLineNumbers = null) => {
                if (updateTextarea) codeArea.value = text;
                let gutterContent = '';
                if (customLineNumbers) {
                    customLineNumbers.forEach(n => gutterContent += (n + 1) + '\n');
                } else {
                    const linesCount = text ? text.split('\n').length : 0;
                    for (let i = 1; i <= linesCount; i++) gutterContent += i + '\n';
                }
                lineNumbers.textContent = gutterContent;
            };

            codeArea.oninput = () => setEditorValue(codeArea.value, false);

            filterInput.oninput = () => {
                const term = filterInput.value.toLowerCase();
                const lines = originalContent.split('\n');
                const total = originalContent ? lines.length : 0;
                if (!term) {
                    setEditorValue(originalContent);
                    filterCount.textContent = `Total lines: ${total}`;
                    return;
                }
                const filtered = lines.map((line, idx) => ({ line, idx }))
                    .filter(item => item.line.toLowerCase().includes(term));
                setEditorValue(filtered.map(i => i.line).join('\n'), true, filtered.map(i => i.idx));
                filterCount.textContent = `Showing ${filtered.length} of ${total} lines`;
            };

            if (!fileName) {
                setEditorValue('Select a file from the explorer to view its content.');
            } else if (isTextFile(fileName)) {
                setEditorValue(originalContent);
                if (forceReadOnly) {
                    setTimeout(() => { codeArea.scrollTop = codeArea.scrollHeight; }, 50);
                }
            } else {
                setEditorValue(`[INFO] The file "${fileName}" is in a non-textual format and cannot be displayed here.`);
                codeArea.style.color = "#aaa";
            }

            const loadFileContent = async (targetFile) => {
                codeArea.style.color = "#eee";
                setEditorValue(`Loading ${targetFile}...`);
                const nameSpan = header.querySelector('.sc-view-filename');
                if (nameSpan) nameSpan.textContent = targetFile;

                filterInput.value = '';
                // Display filter only if the modal was opened in log mode (forceReadOnly)
                filterSection.style.display = forceReadOnly ? 'flex' : 'none';
                filterContainer.style.display = isTextFile(targetFile) ? 'flex' : 'none';
                sidebar.style.display = isSidebarHidden(currentRoot) ? 'none' : 'flex';

                if (!isTextFile(targetFile)) {
                    codeArea.value = `[INFO] File "${targetFile}" is non-textual.`;
                    codeArea.style.color = "#777";
                    return;
                }
                try {
                    const res = await fetch(`/plugins/Updater/read-file?fileName=${encodeURIComponent(targetFile)}&root=${currentRoot}`);
                    if (!res.ok) throw new Error();
                    const fetchedText = await res.text();
                    let displayContent = fetchedText;

                    // Handle cache sync metadata
                    if (currentRoot === 'cache') {
                        try {
                            const data = JSON.parse(fetchedText);
                            displayContent = data.content;
                            if (data.isStale) {
                                const warning = document.createElement('div');
                                warning.style.cssText = 'background:#fff3cd; color:#856404; padding:10px; border-bottom:1px solid #ffeeba; font-size:12px; font-weight:bold; text-align:center;';
                                const fileDate = new Date(data.lastModified).toLocaleString();
                                warning.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <b>Cache Out of Sync:</b> The version in memory is outdated.<br>` +
                                    `<small>File on disk: ${fileDate} | Loaded at start: ${data.serverStartedAt}</small><br>` +
                                    `Restart the server to apply changes.`;
                                editorArea.insertBefore(warning, editorArea.firstChild);
                                setTimeout(() => warning.remove(), 10000); // Remove after 10s
                            }
                        } catch (e) { }
                    }

                    setEditorValue(displayContent);
                    originalContent = displayContent;
                    if (forceReadOnly) {
                        const total = originalContent ? originalContent.split('\n').length : 0;
                        filterCount.textContent = `Total lines: ${total}`;
                        setTimeout(() => { codeArea.scrollTop = codeArea.scrollHeight; }, 50);
                    }
                } catch (e) { setEditorValue("Error reading file."); }

                codeArea.readOnly = true;
                codeWrapper.style.borderColor = '#333';
                enableEditBtn.style.display = isEditableFile(targetFile, currentRoot) ? 'block' : 'none';
                deleteFileBtn.style.display = isDeletableFile(targetFile, currentRoot) ? 'block' : 'none';
                saveBtnContainer.style.display = 'none';
            };

            const createExplorerSection = (label, root) => {
                const btn = document.createElement('div');
                btn.style.cssText = 'padding:10px; cursor:pointer; background:#262626; border:1px solid #3d3d3d; border-radius:4px; font-weight:bold; display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; color:#eee; font-size:13px;';
                btn.innerHTML = `<span><i class="fa-solid fa-folder-open" style="color:#ffcc00; margin-right:8px;"></i>${label}</span><i class="fa-solid fa-chevron-down"></i>`;

                if (root === 'plugins') btn.title = "Browse the main plugins/ directory of the server";
                else if (root === 'configs') btn.title = "Browse the plugins_configs/ directory where plugin settings are stored";

                sidebar.appendChild(btn);

                const container = document.createElement('div');
                container.style.display = 'none';
                sidebar.appendChild(container);

                btn.onclick = () => {
                    const isHidden = container.style.display === 'none';
                    container.style.display = isHidden ? 'block' : 'none';
                    const icon = btn.querySelector('.fa-chevron-down, .fa-chevron-up');
                    if (icon) icon.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
                    if (isHidden && container.innerHTML === '') loadDir('', container, root);
                };
                return { btn, container };
            };

            const loadDir = async (path, container, root) => {
                currentRoot = root;
                currentExplorerPath = path;
                container.innerHTML = path ? `<div style="padding:8px 10px; font-size:12px; color:#3fa9f5; font-weight:bold; background:#1c1c1c; margin-bottom:5px; border-radius:4px; border-left:3px solid #3fa9f5;">${path}</div>` : '';
                const ul = document.createElement('ul');
                ul.style.cssText = 'list-style:none; padding:0; margin:0; font-size:13px;';
                container.appendChild(ul);

                if (path) {
                    const li = document.createElement('li');
                    li.style.cssText = 'padding:5px; cursor:pointer; color:#3fa9f5; font-weight:bold;';
                    li.innerHTML = `<i class="fa-solid fa-arrow-left"></i> .. [Back]`;
                    li.onclick = () => loadDir(path.split('/').filter(x => x).slice(0, -1).join('/'), container, root);
                    ul.appendChild(li);
                }

                try {
                    const res = await fetch(`/plugins/Updater/list-dir?path=${encodeURIComponent(path)}&root=${root}`);
                    const items = await res.json();
                    items.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name)).forEach(item => {
                        const li = document.createElement('li');
                        li.style.cssText = 'padding:6px; cursor:pointer; border-bottom:1px solid #2b2b2b; display:flex; align-items:center; gap:8px; color:#ddd;';
                        const icon = item.isDir ? 'fa-folder' : 'fa-file-code';
                        const timeStr = item.mtime ? new Date(item.mtime).toLocaleString() : '';
                        li.innerHTML = `<i class="fa-solid ${icon}" style="color:${item.isDir ? '#ffcc00' : '#888'};"></i> ${item.name} ${timeStr ? `<span style="color:#888; font-size:9px; margin-left:auto;">(${timeStr})</span>` : ''}`;
                        li.onclick = () => item.isDir ? loadDir(path ? `${path}/${item.name}` : item.name, container, root) : loadFileContent(path ? `${path}/${item.name}` : item.name, root);
                        ul.appendChild(li);
                    });
                } catch (e) { }
            };

            const pluginsSection = createExplorerSection('plugins', 'plugins');
            const configsSection = createExplorerSection('plugins_configs', 'configs');

            const uploadBtn = document.createElement('button');
            uploadBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload File';
            uploadBtn.title = "Upload a file from your PC to the current directory";
            uploadBtn.style.cssText = 'width:100%; height:32px; line-height:32px; padding:0 10px; margin-bottom:15px; border:none; background:#3fa9f5; color:#fff; cursor:pointer; border-radius:4px; font-weight:bold; font-size:13px; flex-shrink:0; display:block;';
            sidebar.insertBefore(uploadBtn, pluginsSection.btn);

            const MAX_UPLOAD_CHUNK_BYTES = 900 * 1024;
            const fileUploaderEncoder = new TextEncoder();

            const uploadFileInChunks = async (targetPath, content, root) => {
                const totalBytes = fileUploaderEncoder.encode(content).length;
                const sendChunk = async (chunk, append) => {
                    return fetch('/plugins/Updater/save-file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fileName: targetPath, content: chunk, root, append })
                    });
                };

                if (totalBytes <= MAX_UPLOAD_CHUNK_BYTES) {
                    return sendChunk(content, false);
                }

                let position = 0;
                let chunkIndex = 0;
                while (position < content.length) {
                    let end = Math.min(content.length, position + MAX_UPLOAD_CHUNK_BYTES);
                    let chunk = content.slice(position, end);
                    while (fileUploaderEncoder.encode(chunk).length > MAX_UPLOAD_CHUNK_BYTES) {
                        chunk = chunk.slice(0, -1);
                    }

                    const res = await sendChunk(chunk, chunkIndex > 0);
                    if (!res.ok) return res;

                    position += chunk.length;
                    chunkIndex += 1;
                }
                return { ok: true };
            };

            uploadBtn.onclick = () => {
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.onchange = (e) => {
                    const file = e.target.files[0];
                    if (!file) return;

                    const rootPrefix = currentRoot === 'configs' ? 'plugins_configs' : (currentRoot === 'server' ? '' : 'plugins');
                    const folder = currentExplorerPath || (logicalName || '');
                    const relativeDefault = folder ? `${folder}/${file.name}` : file.name;
                    const fullDefault = (rootPrefix ? rootPrefix + '\\' : '') + relativeDefault.replace(/\//g, '\\');

                    const userPath = prompt("Confirm destination path:", fullDefault);
                    if (userPath === null) return;

                    let finalPath = userPath.replace(/\\/g, '/');
                    if (rootPrefix && finalPath.startsWith(rootPrefix + '/')) {
                        finalPath = finalPath.substring(rootPrefix.length + 1);
                    }

                    const reader = new FileReader();
                    reader.onload = async (event) => {
                        const content = event.target.result;
                        try {
                            const res = await uploadFileInChunks(finalPath, content, currentRoot);
                            if (res.ok) {
                                alert('File uploaded successfully!');
                                const activeContainer = currentRoot === 'configs' ? configsSection.container : pluginsSection.container;
                                const parentDir = finalPath.includes('/') ? finalPath.substring(0, finalPath.lastIndexOf('/')) : '';
                                loadDir(parentDir, activeContainer, currentRoot);
                            } else {
                                const msg = await res.text();
                                alert('Upload failed: ' + msg);
                            }
                        } catch (e) { alert('Connection error.'); }
                    };
                    reader.readAsText(file);
                };
                fileInput.click();
            };

            const localFilesContainer = document.createElement('div');
            sidebar.prepend(localFilesContainer);

            const scanLocalFiles = async () => {
                if (!fileName && !localDir) return;
                try {
                    const res = await fetch(`/plugins/Updater/scan-local-files?fileName=${encodeURIComponent(fileName || '')}&localDir=${encodeURIComponent(localDir || '')}`);
                    if (!res.ok) return;
                    const files = await res.json();

                    // Popoliamo il set dei nomi file per il filtraggio della cache
                    files.forEach(f => localFilenames.add(f.split(/[\\/]/).pop()));

                    if (files.length > 0) {
                        const metaDiv = document.createElement('div');
                        metaDiv.style.cssText = 'margin-bottom:15px; background:#f0fff0; border:1px solid #c2e0c2; border-radius:4px; padding:10px; border-left: 3px solid #2d5a2d;';
                        metaDiv.title = "Files physically present on disk within this plugin's dedicated folder";
                        metaDiv.innerHTML = `<div style="font-weight:bold; font-size:11px; color:#2d5a2d; margin-bottom:8px; text-transform:uppercase;">Local Plugin Files:</div>`;
                        const metaUl = document.createElement('ul');
                        metaUl.style.cssText = 'list-style:none; padding:0; margin:0; font-size:11px; display:flex; flex-direction:column; gap:6px; font-family:monospace;';
                        files.forEach(f => {
                            const li = document.createElement('li');
                            li.style.cursor = 'pointer';
                            li.innerHTML = `<span style="color:#0066cc; text-decoration:underline;">${f}</span>`;
                            li.onclick = () => { currentRoot = 'plugins'; loadFileContent(f); };
                            metaUl.appendChild(li);
                        });
                        metaDiv.appendChild(metaUl);
                        localFilesContainer.innerHTML = '';
                        localFilesContainer.appendChild(metaDiv);
                    }

                    // Scan Node.js Cache for matching files
                    const cacheRes = await fetch('/plugins/Updater/debug-cache?t=' + Date.now());
                    if (cacheRes.ok) {
                        const data = await cacheRes.json();
                        const cacheInfo = data.details || [];
                        const serverStartTimeStr = data.serverStartTime || '';

                        const filtered = cacheInfo.filter(item => localFilenames.has(item.path.split(/[\\/]/).pop()));

                        if (filtered.length > 0) {
                            const cacheDiv = document.createElement('div');
                            cacheDiv.style.cssText = 'margin-bottom:15px; background:#f3e5f5; border:1px solid #d1c4e9; border-radius:4px; padding:10px; border-left: 3px solid #673ab7;';
                            cacheDiv.title = "Backend modules currently loaded in the Node.js RAM cache. If 'Out of Sync', disk changes are not yet active in memory.";
                            cacheDiv.innerHTML = `<div style="font-weight:bold; font-size:11px; color:#512da8; margin-bottom:4px; text-transform:uppercase;">Node.js Cache Files:</div>`;
                            if (serverStartTimeStr) {
                                cacheDiv.innerHTML += `<div style="font-size:10px; color:#666; margin-bottom:8px; font-style:italic;">Server started: ${serverStartTimeStr}</div>`;
                            }
                            const cacheUl = document.createElement('ul');
                            cacheUl.style.cssText = 'list-style:none; padding:0; margin:0; font-size:11px; display:flex; flex-direction:column; gap:6px; font-family:monospace;';

                            filtered.forEach(item => {
                                const baseName = item.path.split(/[\\/]/).pop();
                                const timeStr = item.mtime ? new Date(item.mtime).toLocaleString() : '--:--';
                                const syncStatus = item.isStale ? ' <span style="color:red; font-weight:bold;">[OUT OF SYNC]</span>' : '';
                                const li = document.createElement('li');
                                li.style.cursor = 'pointer';
                                li.innerHTML = `<span style="color:#0066cc; text-decoration:underline;">${baseName}</span> <span style="color:#888; font-size:9px;">(${timeStr})</span>${syncStatus}`;
                                li.onclick = () => { currentRoot = 'cache'; loadFileContent(item.path); };
                                cacheUl.appendChild(li);
                            });
                            cacheDiv.appendChild(cacheUl);
                            sidebar.insertBefore(cacheDiv, uploadBtn);
                        }
                    }
                } catch (e) { }
            };
            scanLocalFiles();

            // Show skipped files (files in the repo but not downloaded locally)
            if (notDownloadedFiles && notDownloadedFiles.length > 0) {
                const skipDiv = document.createElement('div');
                skipDiv.style.cssText = 'margin-bottom:15px; background:#fff8e1; border:1px solid #ffe082; border-radius:4px; padding:10px; border-left: 3px solid #856404;';
                skipDiv.title = "Files detected in the GitHub repository that were not downloaded during the last update (skipped files)";
                skipDiv.innerHTML = `<div style="font-weight:bold; font-size:11px; color:#856404; margin-bottom:8px; text-transform:uppercase;">SKIPPED (Not Downloaded):</div>`;
                const skipUl = document.createElement('ul');
                skipUl.style.cssText = 'list-style:none; padding:0; margin:0; font-size:11px; display:flex; flex-direction:column; gap:4px; font-family:monospace; color:#666;';
                notDownloadedFiles.forEach(f => {
                    const li = document.createElement('li');
                    li.style.marginBottom = '2px';
                    li.textContent = f;
                    skipUl.appendChild(li);
                });
                skipDiv.appendChild(skipUl);
                sidebar.prepend(skipDiv);
            }

            // Repository Link Section (at the very top of the sidebar)
            if (repoUrl) {
                const repoDiv = document.createElement('div');
                repoDiv.style.cssText = 'margin-bottom:15px; background:#eef9ff; border:1px solid #cceeff; border-radius:4px; padding:10px; border-left: 3px solid #3fa9f5;';
                repoDiv.title = "Link to the plugin's source code on GitHub";
                repoDiv.innerHTML = `
                        <div style="font-weight:bold; font-size:11px; color:#0066cc; margin-bottom:8px; text-transform:uppercase;">Repository:</div>
                        <div style="font-size:11px; font-family:monospace; word-break:break-all;">
                            <a href="${repoUrl}" target="_blank" style="color:#0066cc; text-decoration:underline;">${repoUrl}</a>
                        </div>
                    `;
                sidebar.prepend(repoDiv);
            }

            // Detect the initial directory to browse based on the file's path
            let initialDir = '';
            if (fullPath) {
                const normalized = fullPath.replace(/\\/g, '/');
                const parts = normalized.split('/plugins/');
                if (parts.length > 1) initialDir = parts[1].split('/')[0];
            }
            const activeSection = initialRoot === 'configs' ? configsSection : pluginsSection;
            //         activeSection.btn.click();
            if (initialDir && !initialDir.endsWith('.js')) {
                loadDir(initialDir, activeSection.container, initialRoot);
            }

            const footer = document.createElement('div');
            footer.style.cssText = 'display:flex; justify-content:flex-end; margin-top:15px; gap:10px;';
            editorArea.appendChild(footer);

            const enableEditBtn = document.createElement('button');
            enableEditBtn.innerHTML = '<i class="fa-solid fa-pencil"></i> Enable Editing';
            enableEditBtn.title = "Unlock the editor to make manual changes to this file";
            enableEditBtn.style.cssText = 'padding:8px 15px; border:none; background:#ffaa00; color:#fff; cursor:pointer; border-radius:4px; font-weight:bold; width:auto !important; min-width:0 !important; flex:0 0 auto;';
            enableEditBtn.style.display = isEditableFile(fileName, currentRoot) ? 'block' : 'none';
            footer.appendChild(enableEditBtn);

            const deleteFileBtn = document.createElement('button');
            deleteFileBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete File';
            deleteFileBtn.title = "Permanently delete this file from the server";
            deleteFileBtn.style.cssText = 'padding:8px 15px; border:none; background:#fe0830; color:#fff; cursor:pointer; border-radius:4px; font-weight:bold; width:auto !important; min-width:0 !important; flex:0 0 auto;';
            deleteFileBtn.style.display = isDeletableFile(fileName, currentRoot) ? 'block' : 'none';
            footer.appendChild(deleteFileBtn);

            const saveBtnContainer = document.createElement('div');
            saveBtnContainer.style.cssText = 'display:none; gap:10px;';
            footer.appendChild(saveBtnContainer);

            const cancelBtn = document.createElement('button');
            cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> Cancel';
            cancelBtn.title = "Cancel all unsaved changes and return to read-only mode"; // Keep the same title for now, or adjust if needed
            cancelBtn.style.cssText = 'padding:8px 15px; border:1px solid #444; background:#333; color:#fff; cursor:pointer; border-radius:4px; font-weight:bold; width:auto !important; min-width:0 !important; flex:0 0 auto;';
            saveBtnContainer.appendChild(cancelBtn);

            const saveBtn = document.createElement('button');
            saveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Save Changes';
            saveBtn.title = "Apply and save changes to the server";
            saveBtn.style.cssText = 'padding:8px 15px; border:none; background:#3fa9f5; color:#fff; cursor:pointer; border-radius:4px; font-weight:bold; width:auto !important; min-width:0 !important; flex:0 0 auto;';
            saveBtnContainer.appendChild(saveBtn);

            enableEditBtn.onclick = () => {
                const currentFile = header.querySelector('.sc-view-filename').textContent;
                if (!currentFile || currentFile === 'Select a file') return alert("Please select a file to edit first.");
                if (!isTextFile(currentFile)) return alert("This file type is not editable.");

                if (confirm("WARNING: Editing directly can break the plugin. Continue?")) {
                    codeArea.readOnly = false;
                    codeWrapper.style.borderColor = '#00ff00';
                    enableEditBtn.style.display = 'none';
                    deleteFileBtn.style.display = 'none';
                    saveBtnContainer.style.display = 'flex';
                }
            };

            deleteFileBtn.onclick = async () => {
                const currentFile = header.querySelector('.sc-view-filename').textContent;
                if (!currentFile || currentFile === 'Select a file') return alert("Please select a file to delete first.");

                if (confirm(`Are you sure you want to delete the file "${currentFile}"?\n\nThis action cannot be undone.`)) {
                    try {
                        const res = await fetch('/plugins/Updater/delete-file', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ fileName: currentFile, root: currentRoot })
                        });
                        if (res.ok) {
                            alert(`File "${currentFile}" deleted successfully.`);

                            // Refresh the sidebar list
                            const parentPath = currentFile.includes('/') ? currentFile.substring(0, currentFile.lastIndexOf('/')) : '';
                            const activeContainer = currentRoot === 'configs' ? configsSection.container : pluginsSection.container;
                            loadDir(parentPath, activeContainer, currentRoot);

                            // Reset viewer
                            codeArea.value = 'Select a file from the explorer to view its content.';
                            header.querySelector('.sc-view-filename').textContent = 'Select a file';
                            deleteFileBtn.style.display = 'none';
                            enableEditBtn.style.display = 'none';
                            saveBtnContainer.style.display = 'none';
                        } else {
                            const errText = await res.text();
                            alert('Error deleting file: ' + errText);
                        }
                    } catch (e) { alert('Connection error.'); }
                }
            };

            cancelBtn.onclick = () => {
                setEditorValue(originalContent);
                codeArea.readOnly = true;
                codeWrapper.style.borderColor = '#333';
                enableEditBtn.style.display = isEditableFile(fileName, currentRoot, forceReadOnly) ? 'block' : 'none';
                deleteFileBtn.style.display = isDeletableFile(fileName, currentRoot, forceReadOnly) ? 'block' : 'none';
                saveBtnContainer.style.display = 'none';
            };

            saveBtn.onclick = async () => {
                saveBtn.disabled = true;
                try {
                    const currentFile = header.querySelector('.sc-view-filename').textContent;
                    const res = await fetch('/plugins/Updater/save-file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fileName: currentFile, content: codeArea.value, root: currentRoot })
                    });
                    if (res.ok) {
                        alert('File saved!');
                        originalContent = codeArea.value;
                        codeArea.readOnly = true;
                        codeWrapper.style.borderColor = '#ddd';
                        enableEditBtn.style.display = isEditableFile(currentFile, currentRoot, false) ? 'block' : 'none';
                        deleteFileBtn.style.display = isDeletableFile(currentFile, currentRoot, false) ? 'block' : 'none';
                        saveBtnContainer.style.display = 'none';
                    }
                } catch (e) { alert('Error saving.'); } finally { saveBtn.disabled = false; }
            };

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        }

        async function openTerminalModal(initialCommand = '') {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:100000; display:flex; align-items:center; justify-content:center; color:#000;';

            const customButtons = settings.customButtons;

            let commandHistory = [];
            let historyIndex = -1;
            let currentBuffer = '';

            const modal = document.createElement('div');
            modal.style.cssText = 'background:#1a1a1a; padding:15px; border-radius:8px; width:95%; max-width:1200px; height:85vh; box-shadow:0 10px 25px rgba(0,0,0,0.5); display:flex; flex-direction:column; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';
            modal.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #333; padding-bottom:8px;">
                        <h3 style="margin:0; color:#fff; font-size:16px;">Server Terminal <span id="terminal-os-label" style="font-size:11px; color:#ffaa00;">(Detecting OS...)</span></h3>
                        <div style="display:flex; gap: 8px;">
                            <button id="terminal-custom-1" class="updater-btn" style="background:#444; color:#fff; padding:2px 0; font-size:10px; border-radius:3px; width:90px; flex-shrink:0; text-align:center;" title="Right click to edit">${customButtons[0].label}</button>
                            <button id="terminal-custom-2" class="updater-btn" style="background:#444; color:#fff; padding:2px 0; font-size:10px; border-radius:3px; width:90px; flex-shrink:0; text-align:center;" title="Right click to edit">${customButtons[1].label}</button>
                            <button id="terminal-clear-btn" class="updater-btn" style="background:#333; color:#fff; padding:2px 0; font-size:10px; border-radius:3px; width:70px; flex-shrink:0; text-align:center;">Clear Screen</button>
                            <button id="terminal-close-btn" class="updater-btn" style="background:#fe0830; color:#fff; padding:2px 0; font-size:10px; border-radius:3px; width:60px; flex-shrink:0; text-align:center;">Cancel</button>
                        </div>
                    </div>

                    <div id="terminal-container" style="flex-grow:1; background:#000; border:1px solid #333; border-radius:4px; overflow-y:auto; padding:15px; font-family:monospace; font-size:14px; line-height: 1.4; color:#0f0; cursor:text;">
                        <div id="terminal-history" style="white-space: pre-wrap; word-break: break-all;">Welcome to the server terminal. Type 'help' for info.</div>
                        <div style="display:flex; align-items:center; margin-top:5px;">
                            <span id="terminal-prompt-path" style="color:#3fa9f5; white-space:nowrap; margin-right:8px;">... ></span>
                            <input type="text" id="terminal-input" autocomplete="off" spellcheck="false" style="flex-grow:1; background:transparent; color:#fff; border:none; outline:none; padding:0; margin:0; font-family:inherit; font-size:inherit; line-height:inherit;">
                        </div>
                    </div>
                    <div style="display:flex; justify-content:flex-end; align-items:center; font-size: 12px; color: #555; margin-top:8px;">
                        <span id="terminal-os-hint">Detecting environment...</span>
                    </div>
                `;

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            const terminalContainer = modal.querySelector('#terminal-container');
            const terminalHistory = modal.querySelector('#terminal-history');
            const terminalInput = modal.querySelector('#terminal-input');
            const terminalCloseBtn = modal.querySelector('#terminal-close-btn');
            const terminalPromptPath = modal.querySelector('#terminal-prompt-path');

            const appendOutput = (text, color = '#0f0') => {
                if (!text) return;
                const span = document.createElement('span');
                span.style.color = color;
                span.textContent = text + (text.endsWith('\n') ? '' : '\n');
                terminalHistory.appendChild(span);
                terminalContainer.scrollTop = terminalContainer.scrollHeight;
            };

            const updatePrompt = (path) => {
                terminalPromptPath.textContent = (path || '') + ' >';
            };

            let lastAttemptedCommand = '';

            const executeCommand = async (cmdOverride = null, sudoPwd = null) => {
                const command = sudoPwd !== null ? lastAttemptedCommand : (cmdOverride !== null ? cmdOverride : terminalInput.value.trim());
                if (!command && sudoPwd === null) return;

                if (command.toLowerCase() === 'cls' || command.toLowerCase() === 'clear') {
                    terminalHistory.innerHTML = '';
                    terminalInput.value = '';
                    appendOutput('Terminal buffer cleared.', '#555');
                    return;
                }

                if (sudoPwd === null) {
                    appendOutput(`> ${command}`, '#fff');
                    lastAttemptedCommand = command;
                }

                terminalInput.value = '';
                terminalInput.disabled = true;
                terminalInput.placeholder = 'Executing...';

                try {
                    const res = await fetch('/plugins/Updater/terminal-command', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ command, sudoPassword: sudoPwd })
                    });
                    const data = await res.json();

                    if (data.needPassword) {
                        const pwd = prompt("Sudo password required for this command:");
                        if (pwd !== null) return executeCommand(null, pwd);
                        appendOutput("Command cancelled: password not provided.", "#ffaa00");
                    }

                    if (data.cwd) updatePrompt(data.cwd);
                    if (data.ok) {
                        appendOutput(data.stdout, '#0f0');
                        if (data.stderr) appendOutput(data.stderr, '#ffaa00');
                    } else {
                        appendOutput(`Error: ${data.error || 'Unknown error'}`, '#fe0830');
                        if (data.stderr) appendOutput(data.stderr, '#ffaa00');
                    }
                } catch (e) {
                    appendOutput(`Connection error: ${e.message}`, '#fe0830');
                } finally {
                    terminalInput.disabled = false;
                    terminalInput.placeholder = '';
                    terminalInput.focus();
                }
            };

            // Caricamento iniziale della posizione corrente
            fetch('/plugins/Updater/terminal-command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: '' })
            }).then(res => res.json()).then(data => {
                if (data.cwd) updatePrompt(data.cwd);
                if (data.platform) {
                    const osLabel = modal.querySelector('#terminal-os-label');
                    const osHint = modal.querySelector('#terminal-os-hint');
                    const isWin = data.platform === 'win32';

                    if (osLabel) {
                        osLabel.innerHTML = isWin ?
                            '<i class="fa-brands fa-windows"></i> Windows (CMD.exe)' :
                            '<i class="fa-brands fa-linux"></i> Linux/Unix (Bash)';
                    }

                    if (osHint) {
                        osHint.innerHTML = isWin ?
                            'CMD.exe (Windows) - Use <code>&&</code> to chain. Type <code>help</code> for info.' :
                            'Bash (Linux/Unix) - Use <code>&&</code> to chain. sudo is supported if password is set.';
                    }

                    terminalHistory.textContent = `Welcome to the server terminal [${isWin ? 'Windows' : 'Linux/Unix'}].` +
                        (isWin ? " Type 'help' for info." : " Type a bash command. Use 'sudo' for admin commands.") + '\n';
                }
            }).catch(() => updatePrompt('server'));

            terminalInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const cmd = terminalInput.value.trim();
                    if (cmd && (commandHistory.length === 0 || commandHistory[commandHistory.length - 1] !== cmd)) {
                        commandHistory.push(cmd);
                    }
                    historyIndex = -1;
                    currentBuffer = '';
                    executeCommand();
                } else if (e.key === 'ArrowUp') {
                    if (commandHistory.length > 0) {
                        e.preventDefault();
                        if (historyIndex === -1) {
                            currentBuffer = terminalInput.value;
                            historyIndex = commandHistory.length - 1;
                        } else if (historyIndex > 0) {
                            historyIndex--;
                        }
                        terminalInput.value = commandHistory[historyIndex];
                    }
                } else if (e.key === 'ArrowDown') {
                    if (historyIndex !== -1) {
                        e.preventDefault();
                        historyIndex++;
                        if (historyIndex >= commandHistory.length) {
                            historyIndex = -1;
                            terminalInput.value = currentBuffer;
                        } else {
                            terminalInput.value = commandHistory[historyIndex];
                        }
                    }
                }
            });
            terminalContainer.onclick = () => terminalInput.focus(); // Focus input on terminal click

            // Event listener for the new "Clear Screen" button
            modal.querySelector('#terminal-clear-btn').onclick = () => {
                terminalHistory.innerHTML = '';
                appendOutput('Terminal cleared.', '#555');
            };
            terminalCloseBtn.onclick = () => overlay.remove();
            const setupCustomBtn = (index) => {
                const btn = modal.querySelector(`#terminal-custom-${index + 1}`);
                btn.onclick = () => {
                    if (customButtons[index].cmd) executeCommand(customButtons[index].cmd);
                    else alert("Command not set. Right click to edit.");
                };
                btn.oncontextmenu = (e) => {
                    e.preventDefault();
                    const editOverlay = document.createElement('div');
                    editOverlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:110000; display:flex; align-items:center; justify-content:center; color:#000;';
                    const editModal = document.createElement('div');
                    editModal.style.cssText = 'background:#fff; padding:20px; border-radius:8px; width:350px; box-shadow:0 10px 25px rgba(0,0,0,0.5); font-family:sans-serif;';
                    editModal.innerHTML = `
                            <h3 style="margin-top:0; font-size:14px; border-bottom:1px solid #ccc; padding-bottom:8px;">Edit Button ${index + 1}</h3>
                            <div style="margin-bottom:12px;">
                                <label style="display:block; font-size:11px; font-weight:bold; margin-bottom:4px;">Label</label>
                                <input type="text" id="edit-btn-label" value="${customButtons[index].label}" style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;">
                            </div>
                            <div style="margin-bottom:15px;">
                                <label style="display:block; font-size:11px; font-weight:bold; margin-bottom:4px;">Command</label>
                                <input type="text" id="edit-btn-cmd" value="${customButtons[index].cmd}" style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;">
                            </div>
                            <div style="display:flex; justify-content:flex-end; gap:8px;">
                                <button id="edit-btn-cancel" style="padding:6px 12px; border:none; background:#eee; cursor:pointer; border-radius:4px; font-size:11px;">Cancel</button>
                                <button id="edit-btn-save" style="padding:6px 12px; border:none; background:#3fa9f5; color:#fff; cursor:pointer; border-radius:4px; font-weight:bold; font-size:11px;">Save</button>
                            </div>
                        `;
                    editOverlay.appendChild(editModal);
                    document.body.appendChild(editOverlay);

                    editModal.querySelector('#edit-btn-cancel').onclick = () => editOverlay.remove();
                    editModal.querySelector('#edit-btn-save').onclick = async () => {
                        const newLabel = editModal.querySelector('#edit-btn-label').value.trim();
                        const newCmd = editModal.querySelector('#edit-btn-cmd').value.trim();
                        customButtons[index].label = newLabel || `Custom ${index + 1}`;
                        customButtons[index].cmd = newCmd;

                        try {
                            await fetch('/plugins/Updater/settings', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(settings)
                            });
                            btn.textContent = customButtons[index].label;
                            btn.title = customButtons[index].cmd ? `Execute: ${customButtons[index].cmd}` : "Right click to edit";
                            editOverlay.remove();
                        } catch (err) { alert("Error saving settings."); }
                    };
                };
            };
            setupCustomBtn(0);
            setupCustomBtn(1);
            if (initialCommand) setTimeout(() => executeCommand(initialCommand), 150);
        }


        function escapeSelectorValue(value) {
            if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
                return CSS.escape(value);
            }
            return value.replace(/(["\\])/g, '\\$1');
        }

        function normalizePluginId(value) {
            if (!value) return '';
            return value.toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        }

        function findPluginIconElement(p) {
            const searchNames = [];
            if (p.name) searchNames.push(p.name);
            if (p.logicalName && p.logicalName !== p.name) searchNames.push(p.logicalName);
            if (p.fileName) searchNames.push(p.fileName.replace(/\.[^.]+$/, ''));
            if (p.name && p.name.includes('(')) {
                const plainName = p.name.replace(/\s*\(.+\)$/, '').trim();
                if (plainName) searchNames.push(plainName);
            }
            const uniqueNames = Array.from(new Set(searchNames.filter(Boolean)));
            const normalizedNames = uniqueNames.map(normalizePluginId).filter(Boolean);

            // First try the standard plugin button pattern: <id>-on-off
            const pluginButtons = Array.from(document.querySelectorAll('button[id$="-on-off"]'));
            for (const button of pluginButtons) {
                const normalizedId = normalizePluginId(button.id.replace(/-on-off$/i, ''));
                if (normalizedNames.includes(normalizedId)) {
                    return button;
                }
            }

            const attrNames = ['title', 'aria-label', 'data-title', 'data-tooltip'];
            for (const name of uniqueNames) {
                const escaped = escapeSelectorValue(name);
                for (const attr of attrNames) {
                    const selector = `[${attr}*=\"${escaped}\"]`;
                    const element = document.querySelector(selector);
                    if (element) return element;
                }
            }

            const buttonCandidates = Array.from(document.querySelectorAll('.headerButton, button, a, div'));
            const lowerNames = uniqueNames.map(n => n.toLowerCase());
            for (const element of buttonCandidates) {
                const text = (element.textContent || '').trim().toLowerCase();
                if (!text) continue;
                if (lowerNames.some(name => text === name || text.includes(name))) {
                    return element;
                }
            }
            return null;
        }

        function closeUpdaterUI() {
            if (isOnSetupPage) {
                if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') {
                    window.location.href = '/';
                }
                return;
            }
            if (container) container.style.display = 'none';
            if (overlay) overlay.style.display = 'none';
        }

        async function togglePluginEnabled(p) {
            const nextEnabled = p.isEnabled !== false;
            try {
                const res = await fetch('/plugins/Updater/plugin-state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pluginName: p.logicalName || p.name || p.fileName, enabled: !nextEnabled })
                });
                if (!res.ok) throw new Error('Unable to save plugin state');
                p.isEnabled = !nextEnabled;
                renderPluginRows();
            } catch (e) {
                alert('Unable to change the plugin state.');
            }
        }

        function renderPluginRows() {
            const tbody = document.getElementById('updater-list-body');
            if (!tbody) return;
            tbody.innerHTML = '';

            currentPlugins.forEach(p => {
                const li = document.createElement('li');
                li.className = 'updater-list-item';

                li.innerHTML = `
                    <div style="flex-grow: 1; display: flex; align-items: center; gap: 10px; overflow: hidden; min-width: 0;">
                        <div class="updater-title" style="flex: 0 0 24%; color: #3fa9f5; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0; min-width: 0; text-align: left !important; display: flex; align-items: center; gap: 6px;" title="${p.fullPath || ''}">
                            ${p.name || 'Unknown'}
                            ${p.hasStaleFiles ? '<i class="fa-solid fa-triangle-exclamation" style="color: #ffaa00; font-size: 12px;" title="Node.js Cache Out of Sync: some backend files have been modified on disk but are not yet reloaded in memory. A server restart is required."></i>' : ''}
                        </div>
                        <div class="updater-subtitle" style="flex: 0 0 15%; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; text-align: left !important;">
                            ${p.author || 'Unknown'}
                        </div>
                        <div class="updater-subtitle" style="flex: 0 0 6%; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; text-align: left !important;">
                            v<span style="color: #fff;">${p.version}</span>
                        </div>
                        <div id="remote-ver-${p.name.replace(/\s+/g, '_')}" class="updater-subtitle" style="flex: 0 0 8%; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; text-align: left !important;">
                            ${p.cachedRemoteVer ? `<span style="color: #fff;">${p.cachedRemoteVer}</span>` : '<span style="color: #666; font-style: italic;">...</span>'}
                        </div>
                        <div id="status-${p.name.replace(/\s+/g, '_')}" style="flex: 1; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; text-align: left !important;">
                            <span style="color: #666; font-style: italic;">Checking...</span>
                        </div>
                    </div>
                    <div style="min-width: 320px; flex-shrink: 0; margin-left: 10px; display: flex; justify-content: flex-end;">
                        <div class="actions-container" style="display: flex; gap: 3px; align-items: center; flex-wrap: nowrap; justify-content: flex-end;">
                            ${/* TEMP DISABLED - rimuovi questo ${ e il } finale per riattivare il bottone
                            `<button class="updater-btn updater-btn-small updater-toggle-btn" style="background:${(p.isEnabled !== false) ? '#1f8f1f' : '#666'}; color:#fff;" title="${(p.isEnabled !== false) ? 'Disable this plugin' : 'Enable this plugin'}">${(p.isEnabled !== false) ? 'Enabled' : 'Disabled'}</button>`
                            */ ''}
                            <button class="updater-btn updater-btn-small updater-edit-btn" style="background:#444; color:#fff;" title="Modify GitHub repository, file paths, or local directory for this plugin">Edit</button>
                            ${settings.advancedMode ? '<button class="updater-btn updater-btn-small updater-explore-btn" style="background:#444; color:#fff;" title="Browse and manage plugin files, view code, or edit configurations">Explore</button>' : ''}
                            
                            <button class="updater-btn updater-btn-small updater-delete-btn" style="background:#444; color:#fff;" title="Completely remove this plugin and its files from the server">Delete</button>
                        </div>
                    </div>
                `;

                li.querySelector('.updater-edit-btn').onclick = () => openEditModal(p, currentPlugins);

                // Action to read and view the local file content
                const viewFileAction = async () => {
                    try {
                        const res = await fetch(`/plugins/Updater/read-file?fileName=${encodeURIComponent(p.fileName)}`);
                        if (!res.ok) throw new Error('File read failed');
                        const content = await res.text();

                        // Calculate remote descriptor URL for reference
                        const owner = resolveOwner(p, currentPlugins);
                        let repo = p.name.replace(/\s+/g, '-');
                        if (p.repoUrl) {
                            const match = p.repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)/);
                            if (match) repo = match[2];
                        }
                        const filePath = p.fileUrl || p.fileName;
                        const branch = p.branch || 'main';
                        const descriptorUrl = filePath.startsWith('http') ? filePath : `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`;

                        openViewFileModal(p.fileName, content, p.downloadedFiles, p.notDownloadedFiles, p.fullPath, p.repoUrl, descriptorUrl, 'plugins', p.localDir, p.logicalName || p.name);
                    } catch (e) {
                        alert("Error: Could not read the local descriptor file.");
                    }
                };

                const exploreBtn = li.querySelector('.updater-explore-btn');
                if (exploreBtn) exploreBtn.onclick = viewFileAction;

                const toggleBtn = li.querySelector('.updater-toggle-btn');
                if (toggleBtn) toggleBtn.onclick = () => togglePluginEnabled(p);

                const delBtn = li.querySelector('.updater-delete-btn');
                if (delBtn) delBtn.onclick = () => performDelete(p);

                tbody.appendChild(li);

                const attempts = p.versionCheckAttempts || 0;
                if ((p.cachedRemoteVer === undefined || p.cachedRemoteVer === null) && !p.versionCheckStopped && attempts < MAX_VERSION_CHECK_ATTEMPTS) {
                    checkUpdate(p, currentPlugins);
                } else {
                    updateStatusCell(p, p.cachedRemoteVer, currentPlugins);
                }
            });
        }

        function sortPlugins(key, toggle = true) {
            if (toggle) {
                if (sortState.key === key) {
                    sortState.asc = !sortState.asc;
                } else {
                    sortState.key = key;
                    // Per lo stato, il primo click attiva l'ordinamento discendente (Update in cima)
                    sortState.asc = (key === 'status' ? false : true);
                }
            }
            // Store key and direction in the browser
            localStorage.setItem('updater-sort-state', JSON.stringify(sortState));

            currentPlugins.sort((a, b) => {
                if (key === 'status') {
                    // Rank: 4: Update, 3: OK, 2: Error, 1: In progress
                    const getRank = (p) => {
                        if (isNewer(p.version || "0.0.0", p.cachedRemoteVer)) return 4;
                        if (p.cachedRemoteVer !== null && p.cachedRemoteVer !== undefined) return 3;
                        if (p.cachedRemoteVer === null) return 2;
                        return 1;
                    };
                    const rankA = getRank(a);
                    const rankB = getRank(b);

                    if (rankA !== rankB) {
                        return sortState.asc ? (rankA - rankB) : (rankB - rankA);
                    }
                    // For identical ranks, always sort by name A-Z
                    return (a.name || '').localeCompare(b.name || '');
                } else {
                    let valA = a[key] || '';
                    let valB = b[key] || '';
                    let cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
                    return sortState.asc ? cmp : -cmp;
                }
            });
            renderPluginRows();
        }

        try {
            const response = await fetch('/plugins/Updater/list?t=' + Date.now());
            if (!response.ok) throw new Error('Fetch error');
            const data = await response.json();
            currentPlugins = data.plugins || data;
            isListLoaded = true;
            if (data.rateLimit) updateRateLimitDisplay(data.rateLimit);

            const status = document.getElementById('updater-status');
            if (currentPlugins.length === 0) {
                status.textContent = "No valid plugin descriptors found.";
                return;
            }
            document.querySelectorAll('.updater-sort-link').forEach(link => {
                link.onclick = () => sortPlugins(link.dataset.sort);
            });
            sortPlugins(sortState.key, false);
            if (status) {
                status.innerHTML = `<div>Detected ${currentPlugins.length} plugins installed in the system.</div>`;
                if (data.serverVersion) checkServerUpdate(data.serverVersion);
            }
        } catch (e) {
            console.log('[Updater] UI still initializing, please wait: ', e);
            const status = document.getElementById('updater-status');
            if (status) {
                status.textContent = "The server is initializing or plugins are still loading. Please refresh the list in a few seconds.";
            }
        }
    }

    function showCacheWarning(serverVersion) {
        if (document.getElementById('updater-cache-warning')) return;
        const cacheWarning = document.createElement('div');
        cacheWarning.id = 'updater-cache-warning';
        cacheWarning.style.cssText = 'background: #fe0830; color: #fff; padding: 12px; margin-bottom: 15px; border-radius: 6px; font-size: 13px; text-align: center; font-weight: bold; border: 2px solid #fff; box-shadow: 0 4px 10px rgba(0,0,0,0.5); position: sticky; top: 0; z-index: 10001;';
        cacheWarning.innerHTML = `
            <i class="fa-solid fa-triangle-exclamation" style="font-size: 20px; margin-bottom: 5px; display: block;"></i>
            CACHE DETECTED: The browser is using version v${pluginVersion}.<br>
            The server version is v${serverVersion}. Please press <b>CTRL + F5</b>.`;
        const listBody = document.getElementById('updater-list-body');
        if (listBody) listBody.parentNode.insertBefore(cacheWarning, listBody);
    }

    await initUpdater();
})();
