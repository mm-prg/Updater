/**
 * ************************************************
 * Updater Plugin for FM-DX Webserver (check version below!)
 * ************************************************
 */

"use strict";

(() => {
    const pluginVersion = '0.0.5';
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
            
            // Se filePath è un URL completo (es. pastebin), lo usiamo direttamente
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

    // Check for other files in the same directory as the descriptor on GitHub
    async function checkExtraFiles(owner, repo, remoteFilePath) {
        const remoteDirPath = remoteFilePath.includes('/') ? remoteFilePath.substring(0, remoteFilePath.lastIndexOf('/')) : "";
        try {
            const apiDirUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${remoteDirPath}?ref=main`;
            const apiRes = await fetch(apiDirUrl);
            if (!apiRes.ok) return null;
            const items = await apiRes.json();
            if (!Array.isArray(items)) return null;

            const extras = items
                .filter(item => item.path !== remoteFilePath)
                .map(item => item.name);
            
            return { dir: remoteDirPath || '(root)', files: extras };
        } catch (e) {
            return null;
        }
    }

    async function initUpdater() {
        let currentPlugins = [];
        // Retrieve the last saved sorting state or set the default one
        let sortState = JSON.parse(localStorage.getItem('updater-sort-state') || '{"key": "status", "asc": false}');

        // Recupera le impostazioni dal server
        let visibility = 'both';
        try {
            const settingsRes = await fetch('/plugins/Updater/settings');
            if (settingsRes.ok) {
                const settings = await settingsRes.json();
                visibility = settings.visibility || 'both';
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
        if (visibility === 'setup' && !isOnSetupPage) return;
        if (visibility === 'main' && !isMainPage) return;

        if (!isOnSetupPage && !(isMainPage && isAdmin)) return;


        if (document.getElementById(pluginId)) return;

        const container = document.createElement('div');
        container.id = pluginId;

        // Define different styles depending on the page
        if (isOnSetupPage) {
            // Integrated style for the SETUP page
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
            // MODAL style (centered) for the MAIN page
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
            <div style="border-bottom: 2px solid #00ff00; padding-bottom: 10px; margin-bottom: 15px;">
                <h2 style="margin: 0; color: #00ff00; line-height: 1.2; text-align: center; font-size: 1.8em; text-transform: uppercase; font-weight: normal; letter-spacing: 1px;">Installed Plugins</h2>
                <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 0.9em; justify-content: flex-start;">
                    <button id="updater-options-btn" style="background: #333; color: #fff; border: 1px solid #555; border-radius: 4px; padding: 4px 0; width: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Options"><i class="fa-solid fa-gear"></i></button>
                    <div style="color: #aaa; font-weight: bold;">(Updater ${pluginVersion})</div>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 12px; padding: 0 5px;">
                <div id="updater-status" style="font-size: 0.9em; color: #00ccff; font-weight: bold;">Scanning files...</div>
                <button id="add-plugin-btn" style="background: #00ccff; color: #000; border: none; border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 11px; font-weight: bold; width: fit-content; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">Add new plugin</button>
                <button id="restart-server-btn" style="background: #ffaa00; color: #000; border: none; border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 11px; font-weight: bold; width: fit-content; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">Restart Server</button>
            </div>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
                    <thead id="updater-table-head">
                        <tr style="border-bottom: 2px solid #555; color: #ccc;">
                            <th style="padding: 10px; cursor: pointer; user-select: none;" data-sort="name">Plugin Name ↕</th>
                            <th style="padding: 10px; cursor: pointer; user-select: none;" data-sort="version">Version ↕</th>
                            <th style="padding: 10px; cursor: pointer; user-select: none;" data-sort="author">Author ↕</th>
                            <th style="padding: 10px; cursor: pointer; user-select: none;" data-sort="status">Status ↕</th>
                            <th style="padding: 10px;">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="updater-list-body"></tbody>
                </table>
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
            createOpenPluginListButton(container);
        }


        document.getElementById('add-plugin-btn').onclick = () => openAddModal(currentPlugins);
        document.getElementById('updater-options-btn').onclick = () => openOptionsModal();
        document.getElementById('restart-server-btn').onclick = async () => {
            if (!confirm("Are you sure you want to restart the webserver? The connection will be lost for a few seconds.")) return;
            try {
                const res = await fetch('/plugins/Updater/restart-server', { method: 'POST' });
                if (res.ok) {
                    alert("Server is restarting. Please wait a few seconds and reload the page.");
                    setTimeout(() => location.reload(), 5000);
                } else {
                    alert("Failed to request restart.");
                }
            } catch (e) {
                // Spesso fallisce perché il server si chiude subito, lo consideriamo un successo
                alert("Restart command sent. Reloading...");
                setTimeout(() => location.reload(), 5000);
            }
        };

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
                    statusCell.innerHTML = `<span style="color: #ffaa00;">Repo not found</span>`;
                } else {
                    const viewLink = `<a href="${fullRepoUrl}" target="_blank" style="margin-left:5px; color:#00ccff; text-decoration:underline; font-size:10px;">View</a>`;
                    
                    if (isNewer(p.version || "0.0.0", remoteVer)) {
                        statusCell.innerHTML = `<span style="color: #fe0830; font-weight: bold;">🚀 Update: ${remoteVer}</span> ${viewLink}`;
                    } else {
                        statusCell.innerHTML = `<span style="color: #00ff00;">✓ Up to date</span> ${viewLink}`;
                    }
                }

                // Add the update button if available or reinstallation
                if (remoteVer) {
                    const actionsCell = statusCell.parentElement.querySelector('td:last-child');
                    const actionsContainer = actionsCell.querySelector('.actions-container');
                    if (actionsContainer) {
                        const isUpdate = isNewer(p.version || "0.0.0", remoteVer);
                        const btnClass = isUpdate ? 'updater-update-btn' : 'updater-reinstall-btn';
                        
                        if (!actionsContainer.querySelector(`.${btnClass}`)) {
                            const otherBtn = actionsContainer.querySelector(isUpdate ? '.updater-reinstall-btn' : '.updater-update-btn');
                            if (otherBtn) otherBtn.remove();

                            const btn = document.createElement('button');
                            btn.className = btnClass;
                            btn.textContent = isUpdate ? 'Update' : 'Reinstall';
                            btn.style.cssText = `background:${isUpdate ? '#fe0830' : '#444'}; color:#fff; border:none; border-radius:4px; padding:4px 6px; cursor:pointer; font-size:10px;`;
                            btn.onclick = () => performUpdate(p);
                            actionsContainer.prepend(btn);
                        }
                    }
                }
            }

            async function checkUpdate(p, allPlugins) {
                const remoteVer = await getRemoteVersion(p, allPlugins);
                p.cachedRemoteVer = remoteVer;

                // If the check was successful (version found) and we had no saved parameters,
                // store the automatically detected values in new_data.json for future runs.
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
                    const response = await fetch('/plugins/Updater/list');
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
                const isUpdate = isNewer(p.version || "0.0.0", p.cachedRemoteVer);
                const msg = isUpdate ? `Update ${p.name} to version ${p.cachedRemoteVer}?` : `Reinstall ${p.name} version ${p.version}?`;
                if (!confirm(msg)) return;

                const owner = resolveOwner(p, currentPlugins);
                let repo = p.name.replace(/\s+/g, '-');
                if (p.repoUrl) {
                    const match = p.repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)/);
                    if (match) repo = match[2];
                }

                // Check for extra files in the directory before downloading
                const remoteDescriptorPath = p.fileUrl || p.githubPath || p.fileName || p.frontEndPath;
                let skipRecursive = false;
                const extras = await checkExtraFiles(owner, repo, remoteDescriptorPath);
                if (extras && extras.files.length > 0) {
                    const extraMsg = `The directory "${extras.dir}" contains additional files:\n- ${extras.files.join('\n- ')}\n\nDo you want to download these files as well?`;
                    if (!confirm(extraMsg)) {
                        skipRecursive = true;
                    }
                }

                // Build the GitHub "raw" base URL
                const rawBaseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main`;

                const statusId = `status-${p.name.replace(/\s+/g, '_')}`;
                const statusCell = document.getElementById(statusId);
                if (statusCell) {
                    statusCell.innerHTML = '<span style="color: #fe0830; font-weight: bold;">Updating...</span>';
                }

                try {
                    const res = await fetch('/plugins/Updater/update-plugin', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            pluginName: p.name,
                            rawBaseUrl: rawBaseUrl,
                            remoteDescriptorPath: remoteDescriptorPath,
                            localDescriptorName: p.fileName,
                            frontEndPath: p.frontEndPath,
                            localDir: p.localDir,
                            skipRecursive: skipRecursive
                        })
                    });
                    const data = await res.json();
                    if (data.ok) {
                        if (data.files) {
                            try {
                                await fetch('/plugins/Updater/save-override', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        pluginName: p.name,
                                        downloadedFiles: data.files
                                    })
                                });
                            } catch (e) {}
                        }
                        const fileList = data.files ? `\n\nDownloaded files:\n- ${data.files.join('\n- ')}` : '';
                        alert(`${p.name} updated successfully!${fileList}`);
                        await refreshList();
                    } else {
                        alert(`Update failed: ${data.error || 'Unknown error'}`);
                        if (statusCell) updateStatusCell(p, p.cachedRemoteVer, currentPlugins);
                    }
                } catch (e) {
                    alert("Connection error during update.");
                    if (statusCell) updateStatusCell(p, p.cachedRemoteVer, currentPlugins);
                }
            }

            async function performDelete(p) {
                let confirmMsg = `Are you sure you want to delete the plugin "${p.name}"?\n\nThis will remove:\n- The descriptor file: ${p.fileName}\n- The local directory: ${p.localDir || '(none)'}\n\nTHIS ACTION CANNOT BE UNDONE.`;
                if (p.name === 'Updater') {
                    confirmMsg += `\n\n⚠️ CRITICAL WARNING: You are about to delete the UPDATER plugin itself. This will remove this management interface and the ability to update other plugins!`;
                }
                if (!confirm(confirmMsg)) return;

                const statusId = `status-${p.name.replace(/\s+/g, '_')}`;
                const statusCell = document.getElementById(statusId);
                if (statusCell) {
                    statusCell.innerHTML = '<span style="color: #fe0830; font-weight: bold;">Deleting...</span>';
                }

                try {
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
                        alert(`${p.name} has been deleted.`);
                        await refreshList();
                    } else {
                        alert(`Deletion failed: ${data.error || 'Unknown error'}`);
                        if (statusCell) updateStatusCell(p, p.cachedRemoteVer, currentPlugins);
                    }
                } catch (e) {
                    alert("Connection error during deletion.");
                    if (statusCell) updateStatusCell(p, p.cachedRemoteVer, currentPlugins);
                }
            }

            function openEditModal(p, allPlugins) {
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:100000; display:flex; align-items:center; justify-content:center; color:#000;';
                
                const modal = document.createElement('div');
                modal.style.cssText = 'background:#fff; padding:20px; border-radius:8px; width:400px; box-shadow:0 10px 25px rgba(0,0,0,0.5);';
                modal.innerHTML = `
                    <h3 style="margin-top:0;">Edit GitHub Data for <b>${p.name}</b></h3>
                    <p style="font-size:12px; color:#666;">Paste the main repository URL (e.g. https://github.com/${resolveOwner(p, allPlugins)}/${p.name.replace(/\s+/g, '-')}).</p>
                    <div style="margin-bottom:15px;">
                        <label style="display:block; font-size:12px; font-weight:bold;">GitHub Repository URL</label>
                        <input type="text" id="edit-repo-url" value="${p.repoUrl || (p.githubOwner && p.githubRepo ? `https://github.com/${p.githubOwner}/${p.githubRepo}` : '')}" placeholder="https://github.com/${resolveOwner(p, allPlugins)}/${p.name.replace(/\s+/g, '-')}" style="width:100%; padding:8px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px;">
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

                modal.querySelector('#cancel-edit').onclick = () => overlay.remove();
                modal.querySelector('#save-edit').onclick = async () => {
                    const repoUrl = modal.querySelector('#edit-repo-url').value.trim();
                    const fileUrl = modal.querySelector('#edit-file-path').value.trim();
                    const localDir = modal.querySelector('#edit-local-dir').value.trim();
                    
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
                            // Clean old fields if present
                            delete p.githubOwner; delete p.githubRepo; delete p.githubPath;
                            delete p.cachedRemoteVer; // Force re-check
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
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:100000; display:flex; align-items:center; justify-content:center; color:#000;';
                
                const modal = document.createElement('div');
                modal.style.cssText = 'background:#fff; padding:20px; border-radius:8px; width:400px; box-shadow:0 10px 25px rgba(0,0,0,0.5);';
                modal.innerHTML = `
                    <h3 style="margin-top:0;">Add New Plugin</h3>
                    <p style="font-size:12px; color:#666; margin-bottom:15px;">Enter the GitHub repository URL. The system will automatically detect the descriptor file and configuration.</p>
                    <div style="margin-bottom:20px;">
                        <label style="display:block; font-size:12px; font-weight:bold; margin-bottom:5px;">GitHub Repository URL</label>
                        <input type="text" id="add-repo-url" placeholder="https://github.com/mm-prg/FavStations" style="width:100%; padding:8px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px;">
                    </div>
                    <div style="margin-bottom:20px;">
                        <label style="display:block; font-size:12px; font-weight:bold; margin-bottom:5px;">Descriptor File Path (.js)</label>
                        <input type="text" id="add-file-path" placeholder="e.g. FavStations.js or Folder/Plugin.js" style="width:100%; padding:8px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px;">
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:10px;">
                        <button id="cancel-add" style="padding:8px 15px; border:none; background:#eee; cursor:pointer; border-radius:4px;">Cancel</button>
                        <button id="save-add" style="padding:8px 15px; border:none; background:#fe0830; color:#fff; cursor:pointer; border-radius:4px;">Discover & Add</button>
                    </div>
                `;

                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                modal.querySelector('#cancel-add').onclick = () => overlay.remove();
                modal.querySelector('#save-add').onclick = async () => {
                    const repoUrl = modal.querySelector('#add-repo-url').value.trim();
                    const manualFilePath = modal.querySelector('#add-file-path').value.trim();
                    if (!repoUrl) return alert("Please enter the Repository URL.");

                    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)/);
                    if (!match) return alert("Invalid GitHub URL. Use: https://github.com/owner/repository");

                    const owner = match[1];
                    const repo = match[2];

                    const saveBtn = modal.querySelector('#save-add');
                    saveBtn.disabled = true;
                    saveBtn.textContent = "Discovering...";

                    // Heuristics to find the main descriptor file
                    const guesses = [];
                    if (manualFilePath) guesses.push(manualFilePath);

                    guesses.push(
                        `${repo}.js`,
                        `${repo.replace(/webserver-/g, '')}.js`,
                        `${repo.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')}.js`,
                        `${repo.charAt(0).toUpperCase() + repo.slice(1)}.js`,
                        `plugins/${repo}.js`
                    );

                    let descriptorText = "";
                    let foundFileUrl = "";

                    for (const g of guesses) {
                        const testUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${g}`;
                        try {
                            const res = await fetch(testUrl);
                            if (res.ok) {
                                descriptorText = await res.text();
                                foundFileUrl = g;
                                break;
                            }
                        } catch(e) {}
                    }

                    if (!descriptorText) {
                        saveBtn.disabled = false;
                        saveBtn.textContent = "Discover & Add";
                        return alert("Could not find a valid plugin descriptor in the repository. Make sure the repository contains a .js file exporting 'pluginConfig'.");
                    }

                    // Check for extra files in the directory
                    let skipRecursive = false;
                    const extras = await checkExtraFiles(owner, repo, foundFileUrl);
                    if (extras && extras.files.length > 0) {
                        const extraMsg = `The directory "${extras.dir}" contains additional files:\n- ${extras.files.join('\n- ')}\n\nDo you want to download these files as well?`;
                        if (!confirm(extraMsg)) {
                            skipRecursive = true;
                        }
                    }

                    // Extract metadata from the discovered descriptor
                    const nameMatch = descriptorText.match(/name\s*:\s*['"]([^'"]+)['"]/);
                    const fePathMatch = descriptorText.match(/frontEndPath\s*:\s*['"]([^'"]+)['"]/);

                    const pluginName = nameMatch ? nameMatch[1] : repo;
                    const fePath = fePathMatch ? fePathMatch[1] : "";
                    const localDir = fePath ? fePath.substring(0, fePath.lastIndexOf('/')).replace(/\\/g, '/') : "";

                    try {
                        const res = await fetch('/plugins/Updater/save-override', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                pluginName: pluginName,
                                repoUrl: repoUrl,
                                fileUrl: foundFileUrl,
                                localDir: localDir || null
                            })
                        });

                        if (res.ok) {
                            // After saving the config, proceed to immediate file download
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
                                    localDir: localDir || null,
                                    skipRecursive: skipRecursive
                                })
                            });
                            
                            const updateData = await updateRes.json();
                            if (updateData.ok && updateData.files) {
                                await fetch('/plugins/Updater/save-override', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        pluginName: pluginName,
                                        downloadedFiles: updateData.files
                                    })
                                }).catch(() => {});
                            }
                            overlay.remove();
                            const fileList = updateData.files ? `\n\nDownloaded files:\n- ${updateData.files.join('\n- ')}` : '';
                            alert(`Plugin "${pluginName}" added and installed successfully!${fileList}`);
                            await refreshList();
                        } else {
                            alert("Error saving plugin.");
                        }
                    } catch (e) {
                        alert("Connection error.");
                    } finally {
                        saveBtn.disabled = false;
                        saveBtn.textContent = "Discover & Add";
                    }
                };
            }

            async function openOptionsModal() {
                let currentVisibility = 'both';
                try {
                    const res = await fetch('/plugins/Updater/settings');
                    if (res.ok) {
                        const data = await res.json();
                        currentVisibility = data.visibility || 'both';
                    }
                } catch (e) {}

                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:100001; display:flex; align-items:center; justify-content:center; color:#000;';
                
                const modal = document.createElement('div');
                modal.style.cssText = 'background:#fff; padding:20px; border-radius:8px; width:320px; box-shadow:0 10px 25px rgba(0,0,0,0.5);';
                modal.innerHTML = `
                    <h3 style="margin-top:0; font-size: 16px;">Updater Options</h3>
                    <p style="font-size:12px; color:#666; margin-bottom:15px;">Choose where to display the Plugin Inventory:</p>
                    <div style="margin-bottom:20px;">
                        <label style="display:block; margin-bottom:8px; font-size:13px; cursor:pointer;"><input type="radio" name="updater-vis" value="both" ${currentVisibility === 'both' ? 'checked' : ''}> Both (Setup & Main Page)</label>
                        <label style="display:block; margin-bottom:8px; font-size:13px; cursor:pointer;"><input type="radio" name="updater-vis" value="setup" ${currentVisibility === 'setup' ? 'checked' : ''}> Setup Page Only</label>
                        <label style="display:block; margin-bottom:8px; font-size:13px; cursor:pointer;"><input type="radio" name="updater-vis" value="main" ${currentVisibility === 'main' ? 'checked' : ''}> Main Page Only</label>
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:10px;">
                        <button id="opt-cancel" style="padding:6px 12px; border:none; background:#eee; cursor:pointer; border-radius:4px; font-size:12px;">Cancel</button>
                        <button id="opt-save" style="padding:6px 12px; border:none; background:#fe0830; color:#fff; cursor:pointer; border-radius:4px; font-size:12px;">Save</button>
                    </div>
                `;
                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                modal.querySelector('#opt-cancel').onclick = () => overlay.remove();
                modal.querySelector('#opt-save').onclick = async () => {
                    const selected = modal.querySelector('input[name="updater-vis"]:checked').value;
                    
                    try {
                        const res = await fetch('/plugins/Updater/settings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ visibility: selected })
                        });
                        if (res.ok) {
                            overlay.remove();
                            alert("Visibility preference saved. Reloading page...");
                            location.reload();
                        }
                    } catch (e) { alert("Error saving settings."); }
                };
            }

            function openViewFileModal(fileName, content, downloadedFiles = [], fullPath = '') {
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:100000; display:flex; align-items:center; justify-content:center; color:#000;';
                
                const modal = document.createElement('div');
                modal.style.cssText = 'background:#fff; padding:20px; border-radius:8px; width:85%; max-width:1000px; height:85vh; display:flex; flex-direction:column; box-shadow:0 10px 25px rgba(0,0,0,0.5);';
                
                const header = document.createElement('div');
                header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #ccc; padding-bottom:5px;';
                header.innerHTML = `<h3 style="margin:0;">Local File: <span class="sc-view-filename" style="color:#00ff00;">${fileName}</span></h3>`;
                
                const closeBtn = document.createElement('button');
                closeBtn.textContent = 'Close';
                closeBtn.style.cssText = 'background:#eee; border:1px solid #ccc; padding:6px 12px; cursor:pointer; border-radius:4px; font-weight:bold;';
                closeBtn.onclick = () => overlay.remove();
                header.appendChild(closeBtn);
                
                modal.appendChild(header);

                let pathInfo = null;
                if (fullPath) {
                    pathInfo = document.createElement('div');
                    pathInfo.style.cssText = 'font-size: 11px; color: #777; margin-bottom: 12px; font-family: monospace; word-break: break-all; background: #f4f4f4; padding: 6px 10px; border-left: 3px solid #00ff00;';
                    pathInfo.innerHTML = `<strong>Full Path:</strong> ${fullPath}`;
                    modal.appendChild(pathInfo);
                }

                const codeArea = document.createElement('textarea');
                codeArea.readOnly = true;
                codeArea.style.cssText = 'flex-grow:1; width:100%; font-family:monospace; font-size:12px; padding:10px; border:1px solid #ddd; border-radius:4px; white-space:pre; overflow:auto; background:#f9f9f9; resize:none; color:#333;';
                codeArea.value = content;

                const loadFileContent = async (targetFile) => {
                    codeArea.value = `Loading ${targetFile}...`;
                    const nameSpan = header.querySelector('.sc-view-filename');
                    if (nameSpan) nameSpan.textContent = targetFile;
                    if (pathInfo) pathInfo.style.display = 'none'; // Nascondiamo il path assoluto per i sottofile
                    
                    try {
                        const res = await fetch(`/plugins/Updater/read-file?fileName=${encodeURIComponent(targetFile)}`);
                        if (!res.ok) throw new Error();
                        codeArea.value = await res.text();
                    } catch (e) {
                        codeArea.value = "Error: Could not read the file content.";
                    }
                };

                if (downloadedFiles && downloadedFiles.length > 0) {
                    const filesHeader = document.createElement('div');
                    filesHeader.style.cssText = 'font-size: 13px; font-weight: bold; margin-bottom: 5px; color: #555;';
                    filesHeader.textContent = 'Downloaded files in last update (click to view):';
                    modal.appendChild(filesHeader);
                    
                    const filesList = document.createElement('div');
                    filesList.style.cssText = 'font-size: 11px; color: #666; background: #f5f5f5; padding: 8px; border-radius: 4px; margin-bottom: 15px; border-left: 3px solid #00ff00; max-height: 100px; overflow-y: auto;';
                    
                    const ul = document.createElement('ul');
                    ul.style.cssText = 'margin:0; padding-left:20px;';
                    downloadedFiles.forEach(f => {
                        const li = document.createElement('li');
                        li.textContent = f;
                        li.style.cssText = 'cursor: pointer; color: #0066cc; text-decoration: underline; margin-bottom: 2px;';
                        li.onmouseover = () => li.style.color = '#fe0830';
                        li.onmouseout = () => li.style.color = '#0066cc';
                        li.onclick = () => loadFileContent(f);
                        ul.appendChild(li);
                    });
                    filesList.appendChild(ul);
                    modal.appendChild(filesList);
                }

                modal.appendChild(codeArea);
                overlay.appendChild(modal);
                document.body.appendChild(overlay);
            }

        function renderPluginRows() {
            const tbody = document.getElementById('updater-list-body');
            if (!tbody) return;
            tbody.innerHTML = '';

            currentPlugins.forEach(p => {
                const row = document.createElement('tr');
                row.style.borderBottom = '1px solid #2a2a2a';
                row.onmouseenter = () => row.style.backgroundColor = 'rgba(255,255,255,0.05)';
                row.onmouseleave = () => row.style.backgroundColor = 'transparent';
                
                row.innerHTML = `
                    <td style="padding: 10px; font-weight: bold; color: #00ccff;">${p.name || 'Unknown'}</td>
                    <td style="padding: 10px;"><span class="${p.isNew ? '' : 'updater-version-view'}" style="background: #333; padding: 2px 6px; border-radius: 4px; ${p.isNew ? '' : 'cursor: pointer; text-decoration: underline;'}" title="${p.isNew ? '' : 'Click to view local file content'}">${p.version || '??'}</span></td>
                    <td style="padding: 10px;">${p.author || '-'}</td>
                    <td style="padding: 10px;" id="status-${p.name.replace(/\s+/g, '_')}">
                        <span style="color: #666; font-style: italic;">Checking...</span>
                    </td>
                    <td style="padding: 10px;">
                        <div class="actions-container" style="display: flex; gap: 4px; align-items: center;">
                            <button class="updater-edit-btn" style="background:#444; color:#fff; border:none; border-radius:4px; padding:4px 6px; cursor:pointer; font-size:10px;">Edit</button>
                            <button class="updater-delete-btn" style="background:#444; color:#fff; border:none; border-radius:4px; padding:4px 6px; cursor:pointer; font-size:10px;">Delete</button>
                        </div>
                    </td>
                `;

                row.querySelector('.updater-edit-btn').onclick = () => openEditModal(p, currentPlugins);
                
                const versionView = row.querySelector('.updater-version-view');
                if (versionView) {
                    versionView.onclick = async () => {
                        try {
                            const res = await fetch(`/plugins/Updater/read-file?fileName=${encodeURIComponent(p.fileName)}`);
                            if (!res.ok) throw new Error('File read failed');
                            const content = await res.text();
                            openViewFileModal(p.fileName, content, p.downloadedFiles, p.fullPath);
                        } catch (e) {
                            alert("Error: Could not read the local descriptor file.");
                        }
                    };
                }

                const delBtn = row.querySelector('.updater-delete-btn');
                if (delBtn) delBtn.onclick = () => performDelete(p);
                
                tbody.appendChild(row);

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
                    // Define a rank for the status: 1: Update, 2: OK, 3: Error/Not found, 4: In progress
                    const getRank = (p) => {
                        if (p.cachedRemoteVer === undefined) return 4;
                        if (p.cachedRemoteVer === null) return 3;
                        if (isNewer(p.version || "0.0.0", p.cachedRemoteVer)) return 1;
                        return 2;
                    };
                    const rankA = getRank(a);
                    const rankB = getRank(b);
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
            const response = await fetch('/plugins/Updater/list');
            if (!response.ok) throw new Error('Fetch error');
            currentPlugins = await response.json();
            const status = document.getElementById('updater-status');
            if (currentPlugins.length === 0) {
                status.textContent = "No valid plugin descriptors found.";
                return;
            }
            const thead = document.getElementById('updater-table-head');
            thead.querySelectorAll('th[data-sort]').forEach(th => {
                th.onclick = () => sortPlugins(th.dataset.sort);
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
