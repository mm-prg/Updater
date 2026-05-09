/**
 * ************************************************
 * Updater Plugin for FM-DX Webserver (v. 0.0.2a)
 * ************************************************
 */

"use strict";

(() => {
    const pluginId = 'updater-plugin-ui-container';
    const defaultRepoOwner = 'mm-prg'; 

    // Risolve l'owner: priorità all'override specifico, poi all'override dell'autore, poi all'autore, infine default
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

    // Funzione per confrontare le versioni (identica a FavStations)
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

    // Recupera la versione dal file .js su GitHub
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
            
            // rds-ai-decoder.js usa cache: 'no-store' e il timestamp per evitare la cache del browser/proxy
            const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
            if (!res.ok) return null;
            const text = await res.text();
            
            // Regex migliorata basata su rds-ai-decoder.js: cerca const pluginVersion, version: '...', ecc.
            const match = text.match(/(?:(?:const|var|let)\s+)?(?:pluginVersion|version)\s*[:=]\s*['"]([^'"]+)['"]/);
            return match ? match[1] : null;
        } catch (e) {
            return null;
        }
    }

    async function initUpdater() {
        let currentPlugins = [];
        let sortState = { key: 'status', asc: false };

        // Mostriamo la tabella solo nella pagina di setup o amministrazione
        const isAdminPage = window.location.pathname.includes('/setup') || !!document.getElementById('plugin-settings');
        if (!isAdminPage) return;
        
        if (document.getElementById(pluginId)) return;

        const container = document.createElement('div');
        container.id = pluginId;
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

        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #555; padding-bottom: 8px; margin-bottom: 10px;">
                <h3 style="margin: 0; color: #fe0830;">Plugin Inventory</h3>
                <button id="add-plugin-btn" style="background: #00ccff; color: #000; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 11px; font-weight: bold;">+ Add Plugin</button>
            </div>
            <div id="updater-status" style="font-size: 0.9em; color: #aaa; margin-bottom: 10px;">Scanning files...</div>
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

        // Inserimento nella UI del Webserver
        const target = document.getElementById('plugin-settings') || document.body;
        if (target === document.body) container.style.maxWidth = "800px";
        target.appendChild(container);

        document.getElementById('add-plugin-btn').onclick = () => openAddModal(currentPlugins);

            // Spostiamo le definizioni delle funzioni prima del loro utilizzo
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
                statusCell.title = `Repository: ${fullRepoUrl}\nDescriptor: ${fullFileUrl}\nLocal Dir: ${p.localDir || '(root)'}`;

                if (!remoteVer) {
                    statusCell.innerHTML = `<span style="color: #ffaa00;">Repo not found</span>`;
                } else {
                    const viewLink = `<a href="${fullRepoUrl}" target="_blank" style="margin-left:5px; color:#fff; text-decoration:underline; font-size:10px;">View</a>`;
                    
                    if (isNewer(p.version || "0.0.0", remoteVer)) {
                        statusCell.innerHTML = `<span style="color: #fe0830; font-weight: bold;">🚀 Update: ${remoteVer}</span> ${viewLink}`;
                    } else {
                        statusCell.innerHTML = `<span style="color: #00ff00;">✓ Up to date</span> ${viewLink}`;
                    }
                }

                // Aggiungiamo il pulsante di aggiornamento se disponibile o reinstallazione
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

                // Se il controllo ha avuto successo (abbiamo trovato una versione) e non avevamo parametri salvati,
                // memorizziamo i valori rilevati automaticamente in Updater.json per i futuri avvii.
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

                // Costruiamo l'URL base "raw" di GitHub
                const rawBaseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main`;
                const remoteDescriptorPath = p.fileUrl || p.githubPath || p.fileName || p.frontEndPath;

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
                            localDir: p.localDir
                        })
                    });
                    const data = await res.json();
                    if (data.ok) {
                        const fileList = data.files ? `\n\nDownloaded files:\n- ${data.files.join('\n- ')}` : '';
                        alert(`${p.name} updated successfully!${fileList}\n\nThe page will reload.`);
                        location.reload();
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
                const confirmMsg = `Are you sure you want to delete the plugin "${p.name}"?\n\nThis will remove:\n- The descriptor file: ${p.fileName}\n- The local directory: ${p.localDir || '(none)'}\n\nTHIS ACTION CANNOT BE UNDONE.`;
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
                        location.reload();
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
                            // Aggiorna l'oggetto locale e rifai il check
                            p.repoUrl = repoUrl || null;
                            p.fileUrl = fileUrl || null;
                            p.localDir = localDir || null;
                            // Puliamo vecchi campi se presenti
                            delete p.githubOwner; delete p.githubRepo; delete p.githubPath;
                            delete p.cachedRemoteVer; // Forza il re-check
                            renderPluginRows();

                            // Aggiorna tutti i plugin dello stesso autore perché potrebbero aver ereditato il nuovo owner
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
                            // Dopo il salvataggio della config, procediamo al caricamento immediato dei file
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
                                    localDir: localDir || null
                                })
                            });
                            
                            const updateData = await updateRes.json();
                            overlay.remove();
                            const fileList = updateData.files ? `\n\nDownloaded files:\n- ${updateData.files.join('\n- ')}` : '';
                            alert(`Plugin "${pluginName}" added and installed successfully!${fileList}`);
                            location.reload();
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

            function openViewFileModal(fileName, content) {
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:100000; display:flex; align-items:center; justify-content:center; color:#000;';
                
                const modal = document.createElement('div');
                modal.style.cssText = 'background:#fff; padding:20px; border-radius:8px; width:85%; max-width:1000px; height:85vh; display:flex; flex-direction:column; box-shadow:0 10px 25px rgba(0,0,0,0.5);';
                
                const header = document.createElement('div');
                header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #ccc; padding-bottom:5px;';
                header.innerHTML = `<h3 style="margin:0;">Local File: <span style="color:#fe0830;">${fileName}</span></h3>`;
                
                const closeBtn = document.createElement('button');
                closeBtn.textContent = 'Close';
                closeBtn.style.cssText = 'background:#eee; border:1px solid #ccc; padding:6px 12px; cursor:pointer; border-radius:4px; font-weight:bold;';
                closeBtn.onclick = () => overlay.remove();
                header.appendChild(closeBtn);
                
                const codeArea = document.createElement('textarea');
                codeArea.readOnly = true;
                codeArea.style.cssText = 'flex-grow:1; width:100%; font-family:monospace; font-size:12px; padding:10px; border:1px solid #ddd; border-radius:4px; white-space:pre; overflow:auto; background:#f9f9f9; resize:none; color:#333;';
                codeArea.value = content;
                
                modal.appendChild(header);
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
                            ${p.name !== 'Updater' ? '<button class="updater-delete-btn" style="background:#333; color:#aaa; border:none; border-radius:4px; padding:4px 6px; cursor:pointer; font-size:10px;">Del</button>' : ''}
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
                            openViewFileModal(p.fileName, content);
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

        function sortPlugins(key) {
            if (sortState.key === key) {
                sortState.asc = !sortState.asc;
            } else {
                sortState.key = key;
                sortState.asc = true;
            }
            currentPlugins.sort((a, b) => {
                let cmp = 0;
                if (key === 'status') {
                    // Definiamo un rango per lo stato: 1: Update, 2: OK, 3: Errore/Non trovato, 4: In corso
                    const getRank = (p) => {
                        if (p.cachedRemoteVer === undefined) return 4;
                        if (p.cachedRemoteVer === null) return 3;
                        if (isNewer(p.version || "0.0.0", p.cachedRemoteVer)) return 1;
                        return 2;
                    };
                    const rankA = getRank(a);
                    const rankB = getRank(b);
                    cmp = rankA - rankB;
                    // Se hanno lo stesso rango, ordina per nome
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
            status.textContent = `Rilevati ${currentPlugins.length} plugin installati nel sistema.`;
        } catch (e) {
            console.error('[Updater] UI Error:', e);
            document.getElementById('updater-status').textContent = "Error loading plugin data.";
        }
    }

    initUpdater();
})();
