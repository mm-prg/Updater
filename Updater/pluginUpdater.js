/**
 * ************************************************
 * Updater Plugin for FM-DX Webserver (check version below!)
 * ************************************************
 */

"use strict";

(() => {
    const pluginVersion = '0.0.7c';
    const pluginId = 'updater-plugin-ui-container';
    const defaultRepoOwner = 'mm-prg'; 

    // Resolve the owner: priority to specific override, then author override, then author, finally default
    function resolveOwner(p, allPlugins) {
        if (p.repoUrl) {
            const match = p.repoUrl.match(/github\.com\/([^/]+)/);
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

    // Retrieve the version from the .js file on GitHub
    async function getRemoteVersion(p, allPlugins) {
        try {
            const owner = resolveOwner(p, allPlugins);
            let repo = p.name.replace(/\s+/g, '-');
            if (p.repoUrl) {
                const match = p.repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)/);
                if (match) repo = match[2];
            } else if (p.githubRepo) {
                repo = p.githubRepo;
            }

            const filePath = p.fileUrl || p.githubPath || p.fileName || p.frontEndPath;
            
            // If filePath is a complete URL (e.g., pastebin), we use it directly
            const url = filePath.startsWith('http') ? filePath : `https://raw.githubusercontent.com/${owner}/${repo}/main/${filePath}`;
            
            // rds-ai-decoder.js uses cache: 'no-store' and a timestamp to avoid browser/proxy cache
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
        // Retrieve the last saved sorting state or set the default one
        let sortState = JSON.parse(localStorage.getItem('updater-sort-state') || '{"key": "status", "asc": false}');

        // Retrieve settings from the server
        let settings = { showInPluginPanel: true, showInHeader: true, showInSetup: true };
        try {
            const settingsRes = await fetch('/plugins/Updater/settings');
            if (settingsRes.ok) {
                const data = await settingsRes.json();
                // Migrazione o caricamento nuovi parametri
                if (data.showInPluginPanel !== undefined) {
                    settings = data;
                } else if (data.visibility) {
                    settings.showInSetup = (data.visibility === 'both' || data.visibility === 'setup');
                    settings.showInPluginPanel = settings.showInHeader = (data.visibility === 'both' || data.visibility === 'main');
                }
            }
        } catch (e) {}

        // Determine admin status by checking the page text (as SysInfo does)
        const bodyText = document.body.textContent || document.body.innerText;
        const isAdmin = bodyText.includes("You are logged in as an administrator.") || 
                        bodyText.includes("You are logged in as an adminstrator.");

        const isOnSetupPage = window.location.pathname.includes('/setup');
        const isMainPage = window.location.pathname === '/' || window.location.pathname.endsWith('/index.html') || window.location.pathname === '';

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
            .updater-card { background: #222; padding: 15px; border-radius: 6px; border: 1px solid #333; margin-bottom: 20px; color: #ddd; }
            .updater-list { list-style: none; padding: 0; margin: 0; }
            .updater-list-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; border-left: 3px solid #3fa9f5; background: #1a1a1a; margin-bottom: 8px; border-radius: 4px; color: #ddd; transition: background 0.2s; }
            .updater-list-item:hover { background: #262626; }
            .updater-btn { padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; transition: opacity 0.2s; }
            .updater-btn:hover { opacity: 0.8; }
            .updater-btn-primary { background: #3fa9f5; color: #000; }
            .updater-btn-danger { background: #fe0830; color: #fff; }
            .updater-btn-small { padding: 4px 8px; font-size: 10px; }
            .updater-title { color: #fff; margin: 0; font-size: 1.2em; font-weight: bold; }
            .updater-subtitle { color: #aaa; font-size: 0.85em; margin-top: 2px; }
            .updater-sort-link { color: #3fa9f5; cursor: pointer; text-decoration: none; font-size: 11px; margin-right: 0; }
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
                background: rgba(15, 15, 15, 0.9);
                border: 1px solid #444;
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
                width: 85%;
                max-width: 1000px;
                display: none; /* Hidden by default on the home page */
            `;
        }

        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 10px;">
                <h3 class="updater-title">Installed Plugins</h3>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <a href="https://github.com/mm-prg/Updater" target="_blank" class="updater-btn" style="background:#333; color:#fff; text-decoration:none; display:inline-flex; align-items:center; justify-content:center;" title="Updater Repository"><i class="fa-solid fa-circle-question"></i></a>
                    <button id="updater-options-btn" class="updater-btn" style="background:#333; color:#fff;" title="Options"><i class="fa-solid fa-gear"></i></button>
                    <span style="color: #777; font-size: 11px;">v${pluginVersion}</span>
                </div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <div id="updater-status" class="updater-subtitle" style="color: #3fa9f5; font-weight: bold;">Scanning...</div>
                <button id="add-plugin-btn" class="updater-btn updater-btn-primary" style="width: fit-content;" title="Install a new plugin by providing its GitHub repository URL">Add new plugin</button>
            </div>
            
            <div id="updater-sort-controls" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding: 0 12px; font-weight: bold; text-transform: uppercase; border-bottom: 1px solid #222; padding-bottom: 5px; opacity: 0.8; border-left: 3px solid transparent;">
                <div style="flex-grow: 1; display: flex; align-items: center; gap: 10px; overflow: hidden;">
                    <div class="updater-sort-link" data-sort="name" style="flex: 0 0 25%; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Name ↕</div>
                    <div class="updater-sort-link" data-sort="author" style="flex: 0 0 20%; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Author ↕</div>
                    <div class="updater-sort-link" data-sort="version" style="flex: 0 0 10%; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Ver ↕</div>
                    <div class="updater-sort-link" data-sort="status" style="flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Status ↕</div>
                </div>
                <div style="width: 160px; flex-shrink: 0; margin-left: 10px;"></div>
            </div>

            <ul id="updater-list-body" class="updater-list"></ul>
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


        document.getElementById('add-plugin-btn').onclick = () => openAddModal(currentPlugins);
        document.getElementById('updater-options-btn').onclick = (event) => toggleOptionsDropdown(event);
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
                        btn.onclick = () => {
                            const isVisible = modalContainer.style.display === 'block';
                            modalContainer.style.display = isVisible ? 'none' : 'block';
                            if (overlay) overlay.style.display = isVisible ? 'none' : 'block';
                        };
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

                console.log(`[Updater] Anchor trovato (${menuButton.id || 'per contenuto'}). Iniezione pulsante...`);
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
                console.log("[Updater] Header button inserted successfully.");

                headerBtn.onclick = () => {
                    const overlay = document.getElementById(`${pluginId}-overlay`);
                    const isVisible = modalContainer.style.display === 'block';
                    modalContainer.style.display = isVisible ? 'none' : 'block';
                    if (overlay) overlay.style.display = isVisible ? 'none' : 'block';
                };
            };
            tryAddHeader();
        }

            function updateStatusCell(p, remoteVer, allPlugins) {
                const statusId = `status-${p.name.replace(/\s+/g, '_')}`;
                const statusCell = document.getElementById(statusId);
                if (!statusCell) return;
                
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
                const fullFileUrl = filePath.startsWith('http') ? filePath : `https://raw.githubusercontent.com/${owner}/${repo}/main/${filePath}`;
                statusCell.title = `Repository: ${fullRepoUrl}\nDescriptor: ${fullFileUrl}\nDirectory: ${p.localDir || '(root)'}`;

                if (!remoteVer) {
                    statusCell.innerHTML = `<span style="color: #ffaa00;">Repo not found, edit data!</span>`;
                } else {
                    const viewLink = `<a href="${fullRepoUrl}" target="_blank" style="margin-left:5px; color:#3fa9f5; text-decoration:underline; font-size:10px;">Repo</a>`;
                    
                    if (isNewer(p.version || "0.0.0", remoteVer)) {
                        statusCell.innerHTML = `<span style="color: #fe0830; font-weight: bold;">🚀 Update: ${remoteVer}</span> ${viewLink}`;
                    } else {
                        statusCell.innerHTML = `<span style="color: #00ff00;">✓ Up to date</span> ${viewLink}`;
                    }
                }

                // Add the update button if available or reinstallation
                if (remoteVer) {
                    const actionsContainer = statusCell.closest('li')?.querySelector('.actions-container');
                    if (actionsContainer) {
                        const isUpdate = isNewer(p.version || "0.0.0", remoteVer);
                        const btnClass = isUpdate ? 'updater-update-btn' : 'updater-reinstall-btn';

                        // Rimuovi eventuali pulsanti esistenti per gestire correttamente il cambio di stato (es. da Update a Reinstall)
                        const existingBtn = actionsContainer.querySelector('.updater-update-btn, .updater-reinstall-btn');
                        if (existingBtn) existingBtn.remove();

                        const btn = document.createElement('button');
                        btn.className = `updater-btn updater-btn-small ${btnClass}`;
                        btn.textContent = isUpdate ? 'Update' : 'Reinstall';
                        btn.style.background = isUpdate ? '#fe0830' : '#444';
                        btn.title = isUpdate ? `Download and install the new version (${remoteVer})` : `Force download and overwrite files for the current version (${p.version})`;
                        btn.style.color = '#fff';
                        btn.style.marginRight = '4px';
                        btn.onclick = () => performUpdate(p);
                        actionsContainer.prepend(btn);
                    }
                }
            }

            async function checkUpdate(p, allPlugins) {
                const remoteVer = await getRemoteVersion(p, allPlugins);
                p.cachedRemoteVer = remoteVer;

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
                            pluginName: p.name,
                            repoUrl: repoUrl,
                            fileUrl: fileUrl,
                            localDir: localDir
                        })
                    }).then(res => {
                        if (res.ok) {
                            p.repoUrl = repoUrl; p.fileUrl = fileUrl; p.localDir = localDir;
                            renderPluginRows();
                        }
                    }).catch(() => {});
                }

                updateStatusCell(p, remoteVer, allPlugins);
            }

            async function refreshList() {
                try {
                    const response = await fetch('/plugins/Updater/list?t=' + Date.now());
                    if (!response.ok) throw new Error();
                    const newList = await response.json();

                    // Preserve dynamic data (like cached remote version) to maintain Status sorting
                    newList.forEach(np => {
                        const old = currentPlugins.find(p => p.name === np.name);
                        if (old) np.cachedRemoteVer = old.cachedRemoteVer;
                    });

                    currentPlugins = newList;
                    sortPlugins(sortState.key, false);
                    const status = document.getElementById('updater-status');
                    if (status) status.textContent = `Detected ${currentPlugins.length} plugins installed in the system.`;
                } catch (e) {
                    console.error('[Updater] Refresh error:', e);
                }
            }

            async function performUpdate(p) {
                // Determine if this is a standard version upgrade or a forced reinstallation
                const isUpdate = isNewer(p.version || "0.0.0", p.cachedRemoteVer);
                const msg = isUpdate ? `Update ${p.name} to version ${p.cachedRemoteVer}?` : `Reinstall ${p.name} version ${p.version}?`;
                if (!confirm(msg)) return;

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
                const rawBaseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main`;

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
                            pluginName: p.name,
                            rawBaseUrl: rawBaseUrl,
                            remoteDescriptorPath: remoteDescriptorPath,
                            localDescriptorName: remoteDescriptorPath.split('/').pop(),
                            frontEndPath: p.frontEndPath,
                            localDir: p.localDir,
                            skipRecursive: skipRecursive
                        })
                    });
                    const data = await res.json();
                    if (data.ok) {
                        // If the update succeeded, save the list of modified files to the local configuration
                        if (data.files || data.notDownloadedFiles) {
                            try {
                                await fetch('/plugins/Updater/save-override', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        pluginName: p.name,
                                        downloadedFiles: data.files,
                                        notDownloadedFiles: data.notDownloadedFiles
                                    })
                                });
                            } catch (e) {}
                        }
                        // Construct a detailed summary message for the user
                        const fileList = data.files ? `\n\nDownloaded files:\n- ${data.files.join('\n- ')}` : '';
                        const skipList = data.notDownloadedFiles?.length > 0 ? `\n\nSkipped files (not downloaded):\n- ${data.notDownloadedFiles.join('\n- ')}` : '';
                        const postUpdateMsg = "\n\nAfter the plugin update, you must:\n1) Clear the browser cache;\n2) Restart the server, if necessary.";
                        alert(`${p.name} updated successfully!${postUpdateMsg}${fileList}${skipList}`);
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
                // Construct the confirmation message with details about what will be removed
                let confirmMsg = `Are you sure you want to delete the plugin "${p.name}"?\n\nThis will remove:\n- The descriptor file: ${p.fileName}\n- The local directory: ${p.localDir || '(none)'}\n\nTHIS ACTION CANNOT BE UNDONE.`;
                
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
                            pluginName: p.name,
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
                overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:100000; display:flex; align-items:center; justify-content:center; color:#000;';
                
                const modal = document.createElement('div');
                modal.style.cssText = 'background:#fff; padding:20px; border-radius:8px; width:450px; box-shadow:0 10px 25px rgba(0,0,0,0.5);';
                modal.innerHTML = `
                    <h3 style="margin-top:0;">Edit GitHub Data for <b>${p.name}</b></h3>
                    <p style="font-size:12px; color:#666; margin-bottom:15px;">Enter the GitHub URL and click Verify to auto-fill details.</p>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold;">GitHub Repository URL</label>
                        <div style="display:flex; gap:5px;"><input type="text" id="edit-repo-url" value="${p.repoUrl || (p.githubOwner && p.githubRepo ? `https://github.com/${p.githubOwner}/${p.githubRepo}` : '')}" placeholder="https://github.com/${resolveOwner(p, allPlugins)}/${p.name.replace(/\s+/g, '-')}" style="flex-grow:1; min-width:0; padding:8px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px;"><button id="verify-repo-btn" style="width:34px; height:34px; background:#00ccff; border:none; border-radius:4px; cursor:pointer; font-size:14px; flex-shrink:0; display:flex; align-items:center; justify-content:center;" title="Verify repository contents"><i class="fa-solid fa-magnifying-glass"></i></button></div>
                    </div>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold;">Descriptive File Path / URL (.js)</label>
                        <input type="text" id="edit-file-path" value="${p.fileUrl || p.githubPath || ''}" placeholder="${p.fileName || p.frontEndPath || 'plugin.js'}" style="width:100%; padding:8px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px;">
                    </div>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold;">Local Directory (relative to plugins/)</label>
                        <input type="text" id="edit-local-dir" value="${p.localDir || ''}" placeholder="e.g. MyPluginDir" style="width:100%; padding:8px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px;">
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:10px;">
                        <button id="cancel-edit" style="padding:8px 15px; border:none; background:#eee; cursor:pointer; border-radius:4px;">Cancel</button>
                        <button id="save-edit" style="padding:8px 15px; border:none; background:#fe0830; color:#fff; cursor:pointer; border-radius:4px;">Save Settings</button>
                    </div>
                `;

                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                // Automatically detect plugin info when the "Verify" button is clicked
                modal.querySelector('#verify-repo-btn').onclick = async () => {
                    const repoUrl = modal.querySelector('#edit-repo-url').value.trim();
                    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)/);
                    if (!match) return alert("Please enter a valid GitHub URL first.");

                    const owner = match[1];
                    const repo = match[2];
                    const verifyBtn = modal.querySelector('#verify-repo-btn');
                    const originalHtml = verifyBtn.innerHTML;
                    
                    verifyBtn.disabled = true;
                    verifyBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

                    try {
                        // Step 1: Check root contents to see if a 'plugins' folder exists
                        let contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/`;
                        let res = await fetch(contentsUrl);
                        if (!res.ok) throw new Error("Repository not found or API limit reached.");
                        let files = await res.json();

                        // Determine if we should look in the root or in a 'plugins' subdirectory
                        const pluginsDirItem = files.find(f => f.name.toLowerCase() === 'plugins' && f.type === 'dir');
                        
                        if (pluginsDirItem) {
                            // Scenario: Repository has a 'plugins/' folder containing the descriptor and files
                            res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/plugins`);
                            if (res.ok) {
                                files = await res.json();
                            }
                        }

                        // Step 2: Search for .js files in the identified directory that might be descriptors
                        const jsFiles = files.filter(f => f.name.endsWith('.js') && f.name !== 'index.js' && !f.name.includes('.frontend.'));
                        let found = false;

                        for (const file of jsFiles) {
                            const rawRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/main/${file.path}`);
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
                    
                    if (!repoUrl || !fileUrl || !localDir) {
                        return alert("All three fields (Repository URL, File Path, and Local Directory) are required.");
                    }

                    try {
                        const res = await fetch('/plugins/Updater/save-override', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                pluginName: p.name,
                                repoUrl: repoUrl || null,
                                fileUrl: fileUrl || null,
                                localDir: localDir || null
                            })
                        });
                        if (res.ok) {
                            overlay.remove();
                            // Update local object and re-run check
                            p.repoUrl = repoUrl || null;
                            p.fileUrl = fileUrl || null;
                            p.localDir = localDir || null;
                            // Clean old fields if present // Force re-check
                            delete p.githubOwner; delete p.githubRepo; delete p.githubPath;
                            delete p.cachedRemoteVer;
                            renderPluginRows();

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
                    } catch (e) {
                        alert("Connection error.");
                    }
                };
            }

            function openAddModal(allPlugins) {
                // Create a modal overlay to block interaction with the background
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:100000; display:flex; align-items:center; justify-content:center; color:#000;';
                
                // Build the modal container with input fields for GitHub and local info
                const modal = document.createElement('div');
                modal.style.cssText = 'background:#fff; padding:20px; border-radius:8px; width:450px; box-shadow:0 10px 25px rgba(0,0,0,0.5);';
                modal.innerHTML = `
                    <h3 style="margin-top:0;">Add New Plugin</h3>
                    <p style="font-size:12px; color:#666; margin-bottom:15px;">Enter the GitHub URL and click Verify to auto-fill details.<br>
                    Check the <a href="https://github.com/NoobishSVK/fm-dx-webserver/wiki/Plugin-List" target="_blank" style="color:#3fa9f5; text-decoration:underline;">Plugin List</a> for available repositories.</p>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold; margin-bottom:5px;">GitHub Repository URL</label>
                        <div style="display:flex; gap:5px;">
                            <input type="text" id="add-repo-url" list="repo-datalist" placeholder="https://github.com/mm-prg/FavStations" style="flex-grow:1; min-width:0; padding:8px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px;">
                            <datalist id="repo-datalist"></datalist>
                            <button id="verify-repo-btn" style="width:34px; height:34px; background:#00ccff; border:none; border-radius:4px; cursor:pointer; font-size:14px; flex-shrink:0; display:flex; align-items:center; justify-content:center;" title="Verify repository contents"><i class="fa-solid fa-magnifying-glass"></i></button>
                        </div>
                    </div>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold; margin-bottom:5px;">Descriptor File Path (.js) in Repo</label>
                        <input type="text" id="add-file-path" placeholder="e.g. FavStations.js or Folder/Plugin.js" style="width:100%; padding:8px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px;">
                    </div>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold; margin-bottom:5px;">Local Directory (relative to plugins/)</label>
                        <input type="text" id="add-local-dir" placeholder="e.g. FavStations" style="width:100%; padding:8px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px;">
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:10px;">
                        <button id="cancel-add" style="padding:8px 15px; border:none; background:#eee; cursor:pointer; border-radius:4px;">Cancel</button>
                        <button id="save-add" style="padding:8px 15px; border:none; background:#fe0830; color:#fff; cursor:pointer; border-radius:4px;">Save & Install</button>
                    </div>
                `;

                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                // Carica i repository conosciuti per il datalist
                fetch('/plugins/Updater/read-file?fileName=' + encodeURIComponent('Updater/repo_data.json'))
                    .then(res => res.text())
                    .then(text => {
                        try {
                            const repos = JSON.parse(text);
                            const datalist = modal.querySelector('#repo-datalist');
                            if (datalist && repos) {
                                Object.entries(repos).forEach(([name, url]) => {
                                    const option = document.createElement('option');
                                    option.value = url;
                                    option.textContent = name;
                                    datalist.appendChild(option);
                                });
                            }
                        } catch(e) {}
                    })
                    .catch(() => {});

                // Automatically detect plugin info when the "Verify" button is clicked
                modal.querySelector('#verify-repo-btn').onclick = async () => {
                    const repoUrl = modal.querySelector('#add-repo-url').value.trim();
                    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)/);
                    if (!match) return alert("Please enter a valid GitHub URL first.");

                    const owner = match[1];
                    const repo = match[2];
                    const verifyBtn = modal.querySelector('#verify-repo-btn');
                    const originalHtml = verifyBtn.innerHTML;
                    
                    verifyBtn.disabled = true;
                    verifyBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

                    try {
                        // Step 1: Check root contents to see if a 'plugins' folder exists
                        let contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/`;
                        let res = await fetch(contentsUrl);
                        if (!res.ok) throw new Error("Repository not found or API limit reached.");
                        let files = await res.json();

                        // Determine if we should look in the root or in a 'plugins' subdirectory
                        const pluginsDirItem = files.find(f => f.name.toLowerCase() === 'plugins' && f.type === 'dir');
                        
                        if (pluginsDirItem) {
                            // Scenario: Repository has a 'plugins/' folder containing the descriptor and files
                            res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/plugins`);
                            if (res.ok) {
                                files = await res.json();
                            }
                        }

                        // Step 2: Search for .js files in the identified directory that might be descriptors
                        const jsFiles = files.filter(f => f.name.endsWith('.js') && f.name !== 'index.js' && !f.name.includes('.frontend.'));
                        let found = false;

                        for (const file of jsFiles) {
                            const rawRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/main/${file.path}`);
                            if (rawRes.ok) {
                                const text = await rawRes.text();
                                // A descriptor must contain the 'pluginConfig' variable
                                if (text.includes('pluginConfig')) {
                                    modal.querySelector('#add-file-path').value = file.path;
                                    
                                    // Attempt to guess the local directory by reading the frontEndPath metadata
                                    const feMatch = text.match(/frontEndPath\s*:\s*['"]([^'"]+)['"]/);
                                    if (feMatch && feMatch[1].includes('/')) {
                                        modal.querySelector('#add-local-dir').value = feMatch[1].split('/')[0];
                                    } else {
                                        modal.querySelector('#add-local-dir').value = ""; // Descriptor and files are in root
                                    }
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

                modal.querySelector('#cancel-add').onclick = () => overlay.remove();
                
                // Handle the Save & Install action
                modal.querySelector('#save-add').onclick = async () => {
                    const repoUrl = modal.querySelector('#add-repo-url').value.trim();
                    const manualFilePath = modal.querySelector('#add-file-path').value.trim();
                    const localDir = modal.querySelector('#add-local-dir').value.trim();

                    // Basic validation to ensure all required fields are populated
                    if (!repoUrl || !manualFilePath || !localDir) {
                        return alert("All three fields are required.");
                    }

                    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)/);
                    if (!match) return alert("Invalid GitHub URL. Use: https://github.com/owner/repository");

                    const owner = match[1];
                    const repo = match[2];

                    const saveBtn = modal.querySelector('#save-add');
                    saveBtn.disabled = true;
                    saveBtn.textContent = "Verifying...";

                    // Verify the existence of the plugin descriptor file on GitHub before proceeding
                    let descriptorText = "";
                    const foundFileUrl = manualFilePath;

                    const testUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${foundFileUrl}`;
                    try {
                        const res = await fetch(testUrl);
                        if (res.ok) {
                            descriptorText = await res.text();
                        }
                    } catch(e) {
                        console.error("Error fetching descriptor:", e);
                    }

                    if (!descriptorText) {
                        saveBtn.disabled = false;
                        saveBtn.textContent = "Save & Install";
                        return alert("Could not find the descriptor file at the specified path in the repository.");
                    }

                    let skipRecursive = false;

                    // Extract metadata (name and frontend path) directly from the descriptor source code
                    const nameMatch = descriptorText.match(/name\s*:\s*['"]([^'"]+)['"]/);
                    const fePathMatch = descriptorText.match(/frontEndPath\s*:\s*['"]([^'"]+)['"]/);

                    const pluginName = nameMatch ? nameMatch[1] : repo;
                    const fePath = fePathMatch ? fePathMatch[1] : "";

                    try {
                        // Step 1: Save the plugin configuration/overrides to the server
                        const res = await fetch('/plugins/Updater/save-override', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                pluginName: pluginName,
                                repoUrl: repoUrl,
                                fileUrl: foundFileUrl,
                                localDir: localDir
                            })
                        });

                        if (res.ok) {
                            // Step 2: Trigger the actual file download and installation process
                            saveBtn.textContent = "Downloading files...";
                            const updateRes = await fetch('/plugins/Updater/update-plugin', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    pluginName: pluginName,
                                    rawBaseUrl: `https://raw.githubusercontent.com/${owner}/${repo}/main`,
                                    remoteDescriptorPath: foundFileUrl,
                                    localDescriptorName: foundFileUrl.split('/').pop(),
                                    frontEndPath: fePath,
                                    localDir: localDir,
                                    skipRecursive: skipRecursive
                                })
                            });
                            
                            const updateData = await updateRes.json();
                            if (updateData.ok && (updateData.files || updateData.notDownloadedFiles)) {
                                // Step 3: Record the list of downloaded files for future management/viewing
                                await fetch('/plugins/Updater/save-override', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        pluginName: pluginName,
                                        downloadedFiles: updateData.files,
                                        notDownloadedFiles: updateData.notDownloadedFiles
                                    })
                                }).catch(() => {});
                            }

                            // Success: close modal, show summary, and refresh the plugin list
                            overlay.remove();
                            const fileList = updateData.files ? `\n\nDownloaded files:\n- ${updateData.files.join('\n- ')}` : '';
                            const skipList = updateData.notDownloadedFiles?.length > 0 ? `\n\nSkipped files (not downloaded):\n- ${updateData.notDownloadedFiles.join('\n- ')}` : '';
                            const postInstallMsg = "\n\nAfter loading a new plugin, you must also:\n1) In the fm-dx-webserver setup plugins page, activate the plugin;\n2) Save the new configuration;\n3) Clear the browser cache;\n4) Restart the server, if necessary.";
                            alert(`Plugin "${pluginName}" added and installed successfully!${postInstallMsg}${fileList}${skipList}`);
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
                let currentSettings = { showInPluginPanel: true, showInHeader: true, showInSetup: true };
                try {
                    const res = await fetch('/plugins/Updater/settings');
                    if (res.ok) {
                        const data = await res.json();
                        if (data.showInPluginPanel !== undefined) currentSettings = data;
                    }
                } catch (e) {}
                const dropdown = document.createElement('div');
                dropdown.id = 'updater-options-dropdown';
                dropdown.style.cssText = `position:fixed; top:${rect.bottom + 5}px; left:${rect.left}px; background:#1a1a1a; border:1px solid #444; border-radius:4px; padding:12px; z-index:100002; width:260px; box-shadow:0 4px 20px rgba(0,0,0,0.8); color:#fff; font-size:13px;`;
                dropdown.innerHTML = `
                    <div style="margin-bottom:12px; border-bottom:1px solid #333; padding-bottom:8px; font-weight:bold; color:#00ff00; font-size:11px; text-transform:uppercase;">Visibility</div>
                    <div style="margin-bottom:15px;">
                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;"><input type="checkbox" id="opt-show-panel" ${currentSettings.showInPluginPanel ? 'checked' : ''}> Plugin Panel</label>
                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;"><input type="checkbox" id="opt-show-header" ${currentSettings.showInHeader ? 'checked' : ''}> Header Button</label>
                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;"><input type="checkbox" id="opt-show-setup" ${currentSettings.showInSetup ? 'checked' : ''}> Setup Table</label>
                    </div>
                    <button id="opt-save" style="width:100%; padding:6px; border:none; background:#fe0830; color:#fff; cursor:pointer; border-radius:4px; font-size:11px; font-weight:bold; margin-bottom:15px;">SAVE SETTINGS</button>
                    <div style="border-top:1px solid #333; padding-top:12px;">
                        <div style="margin-bottom:8px; font-weight:bold; color:#00ccff; font-size:11px; text-transform:uppercase;">Files & Explorer</div>
                        <button id="view-new-data-btn" style="background:#333; color:#fff; border:1px solid #444; border-radius:4px; padding:6px; cursor:pointer; font-size:11px; width:100%; margin-bottom:5px; text-align:left; display:flex; align-items:center; gap:8px;"><i class="fa-solid fa-file-code"></i> plugins_data.json</button>
                        <button id="view-repo-data-btn" style="background:#333; color:#fff; border:1px solid #444; border-radius:4px; padding:6px; cursor:pointer; font-size:11px; width:100%; text-align:left; display:flex; align-items:center; gap:8px;"><i class="fa-solid fa-database"></i> repo_data.json</button>
                    </div>
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
                        showInPluginPanel: dropdown.querySelector('#opt-show-panel').checked,
                        showInHeader: dropdown.querySelector('#opt-show-header').checked,
                        showInSetup: dropdown.querySelector('#opt-show-setup').checked
                    };
                    try {
                        const res = await fetch('/plugins/Updater/settings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(newSettings)
                        });
                        if (res.ok) {
                            dropdown.remove();
                            alert("Settings saved. Reloading...");
                            location.reload();
                        }
                    } catch (e) { alert("Error saving settings."); }
                };
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
            }

            function openViewFileModal(fileName, content, downloadedFiles = [], notDownloadedFiles = [], fullPath = '', repoUrl = '', descriptorUrl = '', initialRoot = 'plugins') {
                const textExtensions = ['.js', '.json', '.css', '.html', '.txt', '.md', '.py', '.sh', '.xml', '.yaml', '.yml', '.ini', '.conf'];
                const isTextFile = (name) => textExtensions.some(ext => name.toLowerCase().endsWith(ext));
                let originalContent = content || '';
                let currentRoot = initialRoot || 'plugins'; 
                const getLocalPath = (p) => p.startsWith('plugins/') ? p.substring(8) : p;

                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:100000; display:flex; align-items:center; justify-content:center; color:#000;';
                
                const modal = document.createElement('div');
                modal.style.cssText = 'background:#fff; padding:20px; border-radius:8px; width:95%; max-width:1200px; height:90vh; display:flex; flex-direction:column; box-shadow:0 10px 25px rgba(0,0,0,0.5); color:#333;';

                const rootLabel = initialRoot === 'configs' ? 'configs' : 'plugins';
                const header = document.createElement('div');
                header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #ccc; padding-bottom:5px;';
                header.insertAdjacentHTML('beforeend', `<h3 style="margin:0;"><i class="fa-solid fa-magnifying-glass" style="color:#3fa9f5;"></i> Explore [${rootLabel}]: <span class="sc-view-filename" style="color:#00ff00;">${fileName || 'Select a file'}</span></h3>`);
                
                const closeBtn = document.createElement('button');
                closeBtn.textContent = '×';
                closeBtn.style.cssText = 'background:none; border:none; padding:0; cursor:pointer; font-weight:bold; font-size:24px; line-height:1; width:auto;';
                closeBtn.onclick = () => overlay.remove();
                header.appendChild(closeBtn);
                modal.appendChild(header);

                const mainArea = document.createElement('div');
                mainArea.style.cssText = 'display:flex; flex-grow:1; gap:20px; overflow:hidden;';
                modal.appendChild(mainArea);

                const sidebar = document.createElement('div');
                sidebar.style.cssText = 'flex: 0 0 300px; display:flex; flex-direction:column; border-right:1px solid #eee; padding-right:15px; overflow-y:auto;';
                mainArea.appendChild(sidebar);

                const editorArea = document.createElement('div');
                editorArea.style.cssText = 'flex-grow:1; display:flex; flex-direction:column; overflow:hidden;';
                mainArea.appendChild(editorArea);

                const infoContainer = document.createElement('div');
                editorArea.appendChild(infoContainer);

                const updateInfo = (fName, fPath, rUrl, dUrl) => {
                    infoContainer.innerHTML = '';
                    if (rUrl) {
                        const div = document.createElement('div');
                        div.style.cssText = 'font-size: 11px; color: #777; margin-bottom: 5px; font-family: monospace; background: #f4f4f4; padding: 4px 8px; border-left: 3px solid #00ccff;';
                        div.innerHTML = `<strong>Repo:</strong> <a href="${rUrl}" target="_blank" style="color:#0066cc;">${rUrl}</a>`;
                        infoContainer.appendChild(div);
                    }
                    if (dUrl) {
                        const div = document.createElement('div');
                        div.style.cssText = 'font-size: 11px; color: #777; margin-bottom: 5px; font-family: monospace; background: #f4f4f4; padding: 4px 8px; border-left: 3px solid #3fa9f5;';
                        div.innerHTML = `<strong>GitHub File:</strong> <a href="${dUrl}" target="_blank" style="color:#0066cc;">${dUrl}</a>`;
                        infoContainer.appendChild(div);
                    }
                    if (fPath) {
                        const div = document.createElement('div');
                        div.style.cssText = 'font-size: 11px; color: #777; margin-bottom: 10px; font-family: monospace; background: #f4f4f4; padding: 4px 8px; border-left: 3px solid #00ff00;';
                        div.innerHTML = `<strong>Local:</strong> ${fPath}`;
                        infoContainer.appendChild(div);
                    }
                };
                updateInfo(fileName, fullPath, repoUrl, descriptorUrl);

                const codeArea = document.createElement('textarea');
                codeArea.readOnly = true; // Default to read-only
                codeArea.style.cssText = 'flex-grow:1; width:100%; font-family:monospace; font-size:12px; padding:10px; border:1px solid #ddd; border-radius:4px; white-space:pre; overflow:auto; background:#f9f9f9; resize:none; color:#333;';
                
                if (!fileName) {
                    codeArea.value = 'Select a file from the explorer to view its content.';
                } else if (isTextFile(fileName)) {
                    codeArea.value = content;
                } else {
                    codeArea.value = `[INFO] The file "${fileName}" is in a non-textual format and cannot be displayed here.`;
                    codeArea.style.color = "#777";
                }
                editorArea.appendChild(codeArea);

                const loadFileContent = async (targetFile) => {
                    codeArea.style.color = "#333";
                    codeArea.value = `Loading ${targetFile}...`;
                    const nameSpan = header.querySelector('.sc-view-filename');
                    if (nameSpan) nameSpan.textContent = targetFile;
                    
                    if (!isTextFile(targetFile)) {
                        codeArea.value = `[INFO] File "${targetFile}" is non-textual.`;
                        codeArea.style.color = "#777";
                        return;
                    }
                    try {
                        const res = await fetch(`/plugins/Updater/read-file?fileName=${encodeURIComponent(targetFile)}&root=${currentRoot}`);
                        if (!res.ok) throw new Error();
                        const fetchedText = await res.text();
                        codeArea.value = fetchedText;
                        originalContent = fetchedText;
                        updateInfo(targetFile, (currentRoot === 'configs' ? 'plugins_configs/' : 'plugins/') + targetFile, '', ''); 
                    } catch (e) { codeArea.value = "Error reading file."; }
                    
                    codeArea.readOnly = true;
                    codeArea.style.borderColor = '#ddd';
                    enableEditBtn.style.display = 'block';
                    deleteFileBtn.style.display = 'block';
                    saveBtnContainer.style.display = 'none';
                };

                const createExplorerSection = (label, root) => {
                    const btn = document.createElement('div');
                    btn.style.cssText = 'padding:10px; cursor:pointer; background:#eee; border-radius:4px; font-weight:bold; display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; color:#333; font-size:13px;';
                    btn.innerHTML = `<span><i class="fa-solid fa-folder-open" style="color:#ffcc00; margin-right:8px;"></i>${label}</span><i class="fa-solid fa-chevron-down"></i>`;
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
                    container.innerHTML = path ? `<div style="padding:8px 10px; font-size:12px; color:#3fa9f5; font-weight:bold; background:#f8f8f8; margin-bottom:5px; border-radius:4px; border-left:3px solid #3fa9f5;">${path}</div>` : '';
                    const ul = document.createElement('ul');
                    ul.style.cssText = 'list-style:none; padding:0; margin:0; font-size:13px;';
                    container.appendChild(ul);

                    if (path) {
                        const li = document.createElement('li');
                        li.style.cssText = 'padding:5px; cursor:pointer; color:#3fa9f5; font-weight:bold;';
                        li.innerHTML = `<i class="fa-solid fa-arrow-left"></i> .. [Back]`;
                        li.onclick = () => loadDir(path.split('/').filter(x=>x).slice(0,-1).join('/'), container, root);
                        ul.appendChild(li);
                    }

                    try {
                        const res = await fetch(`/plugins/Updater/list-dir?path=${encodeURIComponent(path)}&root=${root}`);
                        const items = await res.json();
                        items.sort((a,b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name)).forEach(item => {
                            const li = document.createElement('li');
                            li.style.cssText = 'padding:6px; cursor:pointer; border-bottom:1px solid #f9f9f9; display:flex; align-items:center; gap:8px;';
                            const icon = item.isDir ? 'fa-folder' : 'fa-file-code';
                            li.innerHTML = `<i class="fa-solid ${icon}" style="color:${item.isDir ? '#ffcc00' : '#888'};"></i> ${item.name}`;
                            li.onclick = () => item.isDir ? loadDir(path ? `${path}/${item.name}` : item.name, container, root) : loadFileContent(path ? `${path}/${item.name}` : item.name, root);
                            ul.appendChild(li);
                        });
                    } catch(e) {}
                };

                const pluginsSection = createExplorerSection('plugins', 'plugins');
                const configsSection = createExplorerSection('plugins_configs', 'configs');

                if (downloadedFiles && downloadedFiles.length > 0) {
                    const metaDiv = document.createElement('div');
                    metaDiv.style.cssText = 'margin-bottom:15px; background:#f0fff0; border:1px solid #c2e0c2; border-radius:4px; padding:10px;';
                    metaDiv.innerHTML = `<div style="font-weight:bold; font-size:11px; color:#2d5a2d; margin-bottom:5px;">UPDATE RESULTS:</div>`;
                    const metaUl = document.createElement('ul');
                    metaUl.style.cssText = 'list-style:none; padding:0; margin:0; font-size:11px;';
                    downloadedFiles.forEach(f => {
                        const localF = getLocalPath(f);
                        const li = document.createElement('li');
                        li.style.cssText = 'color:#0066cc; cursor:pointer; text-decoration:underline; margin-bottom:2px;';
                        li.textContent = localF;
                        li.onclick = () => loadFileContent(localF);
                        metaUl.appendChild(li);
                    });
                    metaDiv.appendChild(metaUl);
                    sidebar.prepend(metaDiv);
                }

                // Show skipped files (files in the repo but not downloaded locally)
                if (notDownloadedFiles && notDownloadedFiles.length > 0) {
                    const skipDiv = document.createElement('div');
                    skipDiv.style.cssText = 'margin-bottom:15px; background:#fff8e1; border:1px solid #ffe082; border-radius:4px; padding:10px;';
                    skipDiv.innerHTML = `<div style="font-weight:bold; font-size:11px; color:#856404; margin-bottom:5px;">SKIPPED (Not Downloaded):</div>`;
                    const skipUl = document.createElement('ul');
                    skipUl.style.cssText = 'list-style:none; padding:0; margin:0; font-size:11px; color:#666;';
                    notDownloadedFiles.forEach(f => {
                        const li = document.createElement('li');
                        li.style.marginBottom = '2px';
                        li.textContent = f;
                        skipUl.appendChild(li);
                    });
                    skipDiv.appendChild(skipUl);
                    sidebar.prepend(skipDiv);
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
                enableEditBtn.style.cssText = 'padding:8px 15px; border:none; background:#ffaa00; color:#fff; cursor:pointer; border-radius:4px; font-weight:bold;';
                footer.appendChild(enableEditBtn);

                const deleteFileBtn = document.createElement('button');
                deleteFileBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete File';
                deleteFileBtn.title = "Permanently delete this file from the server";
                deleteFileBtn.style.cssText = 'padding:8px 15px; border:none; background:#fe0830; color:#fff; cursor:pointer; border-radius:4px; font-weight:bold;';
                deleteFileBtn.style.display = fileName ? 'block' : 'none';
                footer.appendChild(deleteFileBtn);

                const saveBtnContainer = document.createElement('div');
                saveBtnContainer.style.cssText = 'display:none; gap:10px;';
                footer.appendChild(saveBtnContainer);
                
                const discardBtn = document.createElement('button');
                discardBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Discard';
                discardBtn.title = "Cancel all unsaved changes and return to read-only mode";
                discardBtn.style.cssText = 'padding:8px 15px; border:1px solid #ddd; background:#eee; color:#333; cursor:pointer; border-radius:4px; font-weight:bold;';
                saveBtnContainer.appendChild(discardBtn);

                const saveBtn = document.createElement('button');
                saveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Save Changes';
                saveBtn.title = "Apply and save changes to the server";
                saveBtn.style.cssText = 'padding:8px 15px; border:none; background:#3fa9f5; color:#fff; cursor:pointer; border-radius:4px; font-weight:bold;';
                saveBtnContainer.appendChild(saveBtn);

                enableEditBtn.onclick = () => {
                    const currentFile = header.querySelector('.sc-view-filename').textContent;
                    if (!currentFile || currentFile === 'Select a file') return alert("Please select a file to edit first.");
                    if (!isTextFile(currentFile)) return alert("This file type is not editable.");

                    if (confirm("WARNING: Editing directly can break the plugin. Continue?")) {
                        codeArea.readOnly = false;
                        codeArea.style.borderColor = '#00ff00';
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

                discardBtn.onclick = () => {
                    if (confirm("Discard changes?")) {
                        codeArea.value = originalContent;
                        codeArea.readOnly = true;
                        codeArea.style.borderColor = '#ddd';
                        enableEditBtn.style.display = 'block';
                        deleteFileBtn.style.display = 'block';
                        saveBtnContainer.style.display = 'none';
                    }
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
                            codeArea.style.borderColor = '#ddd';
                            enableEditBtn.style.display = 'block';
                            deleteFileBtn.style.display = 'block';
                            saveBtnContainer.style.display = 'none';
                        }
                    } catch (e) { alert('Error saving.'); } finally { saveBtn.disabled = false; }
                };

                overlay.appendChild(modal);
                document.body.appendChild(overlay);
            }

        function renderPluginRows() {
            const tbody = document.getElementById('updater-list-body');
            if (!tbody) return;
            tbody.innerHTML = '';

            currentPlugins.forEach(p => {
                const li = document.createElement('li');
                li.className = 'updater-list-item';
                
                li.innerHTML = `
                    <div style="flex-grow: 1; display: flex; align-items: center; gap: 10px; overflow: hidden;">
                        <div class="updater-title" style="flex: 0 0 25%; color: #3fa9f5; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${p.fullPath || ''}">${p.name || 'Unknown'}</div>
                        <div class="updater-subtitle" style="flex: 0 0 20%; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${p.author || 'Unknown'}
                        </div>
                        <div class="updater-subtitle" style="flex: 0 0 10%; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            v<span style="color: #fff;">${p.version || '??'}</span>
                        </div>
                        <div id="status-${p.name.replace(/\s+/g, '_')}" style="flex: 1; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <span style="color: #666; font-style: italic;">Checking...</span>
                        </div>
                    </div>
                    <div style="width: 160px; flex-shrink: 0; margin-left: 10px; display: flex; justify-content: flex-end;">
                        <div class="actions-container" style="display: flex; gap: 4px; align-items: center;">
                            <button class="updater-btn updater-btn-small updater-edit-btn" style="background:#444; color:#fff;" title="Modify GitHub repository, file paths, or local directory for this plugin">Edit</button>
                            <button class="updater-btn updater-btn-small updater-explore-btn" style="background:#444; color:#fff;" title="Browse and manage plugin files, view code, or edit configurations">Explore</button>
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
                        const descriptorUrl = filePath.startsWith('http') ? filePath : `https://github.com/${owner}/${repo}/blob/main/${filePath}`;

                        openViewFileModal(p.fileName, content, p.downloadedFiles, p.notDownloadedFiles, p.fullPath, p.repoUrl, descriptorUrl);
                    } catch (e) {
                        alert("Error: Could not read the local descriptor file.");
                    }
                };

                li.querySelector('.updater-explore-btn').onclick = viewFileAction;

                const delBtn = li.querySelector('.updater-delete-btn');
                if (delBtn) delBtn.onclick = () => performDelete(p);
                
                tbody.appendChild(li);

                if (p.cachedRemoteVer !== undefined) {
                    updateStatusCell(p, p.cachedRemoteVer, currentPlugins);
                } else {
                    checkUpdate(p, currentPlugins);
                }
            });
        }

        function sortPlugins(key, toggle = true) {
            if (toggle) {
                if (sortState.key === key) {
                    sortState.asc = !sortState.asc;
                } else {
                    sortState.key = key;
                    sortState.asc = true;
                }
            }
            // Store key and direction in the browser
            localStorage.setItem('updater-sort-state', JSON.stringify(sortState));
            
            currentPlugins.sort((a, b) => {
                let cmp = 0;
                if (key === 'status') {
                    // Define a rank for the status: 1: Update, 2: OK, 3: Error/Not found, 4: In progress // If they have the same rank, sort by name
                    const getRank = (p) => {
                        if (p.cachedRemoteVer === undefined) return 4;
                        if (p.cachedRemoteVer === null) return 3;
                        if (isNewer(p.version || "0.0.0", p.cachedRemoteVer)) return 1;
                        return 2;
                    };
                    const rankA = getRank(a);
                    const rankB = getRank(b); // Store key and direction in the browser
                    cmp = rankA - rankB;
                    // If they have the same rank, sort by name
                    if (cmp === 0) cmp = (a.name || '').localeCompare(b.name || '');
                } else {
                    let valA = a[sortState.key] || '';
                    let valB = b[sortState.key] || '';
                    cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
                }
                return sortState.asc ? cmp : -cmp;
            });
            renderPluginRows();
        }

        try {
            const response = await fetch('/plugins/Updater/list?t=' + Date.now());
            if (!response.ok) throw new Error('Fetch error');
            currentPlugins = await response.json();

            // Verifica discordanza versione (Cache Detection)
            const selfInfo = currentPlugins.find(p => p.name === 'Updater');
            if (selfInfo && selfInfo.version !== pluginVersion) {
                console.warn(`[Updater] Cache Mismatch! Browser: ${pluginVersion}, Server: ${selfInfo.version}`);
                const cacheWarning = document.createElement('div');
                cacheWarning.id = 'updater-cache-warning';
                cacheWarning.style.cssText = 'background: #fe0830; color: #fff; padding: 10px; margin-bottom: 15px; border-radius: 6px; font-size: 13px; text-align: center; font-weight: bold; border: 2px solid #fff;';
                cacheWarning.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ATTENZIONE: Il browser sta usando una versione obsoleta in cache (v${pluginVersion}).<br>La versione corretta è v${selfInfo.version}. Premi <b>CTRL + F5</b> per aggiornare.`;
                const listBody = document.getElementById('updater-list-body');
                if (listBody) listBody.parentNode.insertBefore(cacheWarning, listBody);
            }

            const status = document.getElementById('updater-status');
            if (currentPlugins.length === 0) {
                status.textContent = "No valid plugin descriptors found.";
                return;
            }
            document.querySelectorAll('.updater-sort-link').forEach(link => {
                link.onclick = () => sortPlugins(link.dataset.sort);
            });
            sortPlugins('status');
            status.textContent = `Detected ${currentPlugins.length} plugins installed in the system.`;
        } catch (e) {
            console.error('[Updater] UI Error:', e);
            document.getElementById('updater-status').textContent = "Error loading plugin data.";
        }
    }

    initUpdater();
})();
