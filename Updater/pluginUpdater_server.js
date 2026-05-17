/**
 * ************************************************
 * Updater Plugin for FM-DX Webserver (v. 0.0.7c)
 * ************************************************
 */

"use strict";

const fs = require('fs');
const path = require('path');
const express = require('express');
const https = require('https');
const endpointsRouter = require('../../server/endpoints');
const { logInfo, logError } = require('../../server/console');

const pluginName = "Updater";
// The plugins directory is the one above this script's folder
const pluginsDir = path.resolve(__dirname, '..');
const configsDir = path.resolve(pluginsDir, '..', 'plugins_configs');

// Path for manual settings (GitHub overrides)
const repoDataPath = path.join(__dirname, 'repo_data.json'); // Static file (known)
const overridesPath = path.join(__dirname, 'plugins_data.json'); // Dynamic file (new/modified)
const settingsPath = path.join(configsDir, 'Updater.json'); // Global options file

// Ensure the settings directory exists
if (!fs.existsSync(configsDir)) fs.mkdirSync(configsDir, { recursive: true });
// Ensure the plugins_data.json file exists to avoid read/write errors
if (!fs.existsSync(overridesPath)) fs.writeFileSync(overridesPath, JSON.stringify({}, null, 2), 'utf8');
if (!fs.existsSync(repoDataPath)) fs.writeFileSync(repoDataPath, JSON.stringify({}, null, 2), 'utf8');

logInfo(`[${pluginName}] Backend script is being loaded...`);

function readJsonFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return {};
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw || '{}');
    } catch (e) {
        logError(`[${pluginName}] Error reading ${path.basename(filePath)}:`, e);
        return {};
    }
}

/**
 * Loads plugin data: repo_data.json (known URLs) + plugins_data.json (overrides)
 */
function loadOverrides() { 
    const rawStatic = readJsonFile(repoDataPath);
    const dynamicData = readJsonFile(overridesPath);
    
    // Normalize static data: convert simple URL strings to objects { repoUrl: URL }
    const staticData = {};
    for (const [name, val] of Object.entries(rawStatic)) {
        staticData[name] = typeof val === 'string' ? { repoUrl: val } : val;
    }

    const merged = { ...staticData, ...dynamicData };
    // Filter out plugins explicitly marked as null (deleted)
    return Object.fromEntries(Object.entries(merged).filter(([_, v]) => v !== null));
}

/**
 * Saves to plugins_data.json only data that differs from repo_data.json
 */
function saveOverrides(overrides) { 
    try { 
        const rawStatic = readJsonFile(repoDataPath);
        const toSave = {};

        for (const [name, data] of Object.entries(overrides)) {
            const staticVal = rawStatic[name];
            const staticEntry = typeof staticVal === 'string' ? { repoUrl: staticVal } : (staticVal || {});
            
            if (JSON.stringify(staticEntry) !== JSON.stringify(data)) {
                toSave[name] = data;
            }
        }

        // Record deletions: if it was in static data but is now gone, mark as null
        for (const name of Object.keys(rawStatic)) {
            if (!(name in overrides)) {
                toSave[name] = null;
            }
        }

        fs.writeFileSync(overridesPath, JSON.stringify(toSave, null, 2), 'utf8');
        return true;
    } catch (e) {
        logError(`[${pluginName}] Error saving overrides to plugins_data.json:`, e);
        return false;
    }
}

const download = (url, dest, headers = {}) => new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const options = {
        headers: {
            'User-Agent': 'FM-DX-Webserver-Updater',
            ...headers
        }
    };
    https.get(url, options, (response) => {
        if (response.statusCode !== 200) {
            fs.unlink(dest, () => {});
            return reject(new Error(`Status ${response.statusCode} for ${url}`));
        }
        response.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
    }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
    });
});

/**
 * Helper to query the GitHub API
 */
const fetchGithubApi = (url) => new Promise((resolve, reject) => { // Recursively downloads the content of a folder from GitHub via API
    const options = {
        headers: { 'User-Agent': 'FM-DX-Webserver-Updater' }
    };
    https.get(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { // Download the file
            if (res.statusCode !== 200) return reject(new Error(`API Status ${res.statusCode}`));
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
    }).on('error', reject);
});

/**
 * Automatically discovers descriptor file and local directory from a GitHub repository.
 */
async function discoverMetadataFromRepo(repoUrl) {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)/);
    if (!match) return null;
    const [_, owner, repo] = match;

    try {
        let contents = await fetchGithubApi(`https://api.github.com/repos/${owner}/${repo}/contents/`);
        if (!Array.isArray(contents)) return null;

        const pluginsDirItem = contents.find(f => f.name.toLowerCase() === 'plugins' && f.type === 'dir');
        if (pluginsDirItem) {
            const pContents = await fetchGithubApi(`https://api.github.com/repos/${owner}/${repo}/contents/plugins`);
            if (Array.isArray(pContents)) contents = pContents;
        }

        const jsFiles = contents.filter(f => f.name.endsWith('.js') && f.name !== 'index.js' && !f.name.includes('.frontend.'));
        for (const file of jsFiles) {
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${file.path}`;
            const text = await new Promise((resolve) => {
                https.get(rawUrl, { headers: { 'User-Agent': 'FM-DX-Webserver-Updater' } }, res => {
                    let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
                }).on('error', () => resolve(''));
            });

            if (text.includes('pluginConfig')) {
                const feMatch = text.match(/frontEndPath\s*:\s*['"]([^'"]+)['"]/);
                const localDir = (feMatch && feMatch[1].includes('/')) ? feMatch[1].split('/')[0] : "";
                return { fileUrl: file.path, localDir };
            }
        }
    } catch (e) {
        logError(`[Updater] Auto-discovery failed for ${repoUrl}:`, e);
    }
    return null;
}

/**
 * Recursively downloads the content of a folder from GitHub via API
 */
async function downloadRecursive(owner, repo, branch, remotePath, localBaseDir) { // Create the directory and descend recursively
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${remotePath}?ref=${branch}`;
    const items = await fetchGithubApi(apiUrl);
    let downloadedFiles = [];

    if (!Array.isArray(items)) return downloadedFiles;

    for (const item of items) {
        const localPath = path.join(localBaseDir, item.name);

        if (item.type === 'file') {
            // Download the file
            await download(item.download_url, localPath);
            logInfo(`[Updater] Downloaded: ${item.path}`);
            downloadedFiles.push(item.path);
        } else if (item.type === 'dir') {
            // Create the directory and descend recursively
            if (!fs.existsSync(localPath)) fs.mkdirSync(localPath, { recursive: true });
            const subFiles = await downloadRecursive(owner, repo, branch, item.path, localPath);
            downloadedFiles = downloadedFiles.concat(subFiles);
        }
    }
    return downloadedFiles;
}

/**
 * Endpoint to retrieve global plugin options
 */
endpointsRouter.get('/plugins/Updater/settings', (req, res) => {
    const settings = readJsonFile(settingsPath);
    res.json(settings.showInPluginPanel !== undefined ? settings : { showInPluginPanel: true, showInHeader: true, showInSetup: true });
});

/**
 * Endpoint to save global plugin options
 */
endpointsRouter.post('/plugins/Updater/settings', express.json(), (req, res) => {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(req.body, null, 2), 'utf8');
        res.json({ ok: true });
    } catch (e) {
        logError(`[${pluginName}] Error saving settings to ${settingsPath}:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Endpoint to save manual GitHub data
 */
endpointsRouter.post('/plugins/Updater/save-override', express.json(), (req, res) => {
    try {
        const { pluginName: name, repoUrl, fileUrl, localDir, downloadedFiles, notDownloadedFiles } = req.body; // Merge new data with existing ones to avoid losing information

        // Se il plugin ha un URL repository e non è ancora presente in repo_data.json, lo aggiungiamo
        const rawStatic = readJsonFile(repoDataPath);
        if (repoUrl && !rawStatic[name]) {
            rawStatic[name] = repoUrl;
            fs.writeFileSync(repoDataPath, JSON.stringify(rawStatic, null, 2), 'utf8');
            logInfo(`[${pluginName}] Added repository URL for "${name}" to repo_data.json`);
        }

        // Create local directory if defined and does not exist
        if (localDir && localDir !== "" && localDir !== "." && localDir !== "..") {
            const dirPath = path.join(pluginsDir, localDir);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                logInfo(`[${pluginName}] Created local directory for ${name}: ${localDir}`);
            }
        }

        const overrides = loadOverrides();
        
        overrides[name] = { 
            ...(overrides[name] || {}),
            ...(repoUrl !== undefined && repoUrl !== null && { repoUrl }),
            ...(fileUrl !== undefined && fileUrl !== null && { fileUrl }),
            ...(localDir !== undefined && { localDir }),
            ...(downloadedFiles !== undefined && { downloadedFiles }),
            ...(notDownloadedFiles !== undefined && { notDownloadedFiles })
        };

        if (saveOverrides(overrides)) res.json({ ok: true });
        else res.status(500).json({ ok: false });
    } catch (e) {
        logError(`[${pluginName}] Error in save-override:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Endpoint to perform a plugin update (downloads files from GitHub)
 */
endpointsRouter.post('/plugins/Updater/update-plugin', express.json(), async (req, res) => {
    // Destructure required parameters from the request body
    const { pluginName, rawBaseUrl, remoteDescriptorPath, localDescriptorName, localDir } = req.body;
    try {
        logInfo(`[Updater] Updating plugin: ${pluginName} from ${rawBaseUrl}`);
        
        // Parse the rawBaseUrl to extract Owner, Repo, and Branch
        // Example rawBaseUrl: https://raw.githubusercontent.com/mm-prg/FavStations/main
        const repoMatch = rawBaseUrl.match(/github(?:usercontent)?\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)/);
        if (!repoMatch) throw new Error("Invalid repository URL format");
        const [_, owner, repo, branch] = repoMatch;

        let downloadedList = [];
        let allRepoFiles = [];

        // Step 1: Download the list of all files in the repository (GitHub Tree API)
        try {
            const treeData = await fetchGithubApi(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
            if (treeData && treeData.tree) {
                allRepoFiles = treeData.tree
                    .filter(item => item.type === 'blob')
                    .map(item => item.path);
            }
        } catch (apiErr) {
            logError(`[Updater] Failed to fetch repo tree for ${pluginName}:`, apiErr);
        }

        // Step 2: Download the descriptor file and save it in the local "plugins" directory
        const descriptorUrl = `${rawBaseUrl}/${remoteDescriptorPath}`;
        const descriptorDest = path.join(pluginsDir, localDescriptorName);
        await download(descriptorUrl, descriptorDest);
        downloadedList.push(remoteDescriptorPath);

        // Step 3: Download the contents of the specified files directory and save it locally
        if (localDir && localDir !== "" && localDir !== ".") {
            // Build the remote path. If the descriptor is in a subdirectory (e.g. 'plugins/'),
            // the files directory is likely also located within that same subdirectory.
            let remoteDirPath = localDir.replace(/\\/g, '/');
            const descriptorDir = path.dirname(remoteDescriptorPath).replace(/\\/g, '/');
            
            if (descriptorDir !== "." && descriptorDir !== "" && !remoteDirPath.startsWith(descriptorDir + "/")) {
                // Prepend the descriptor's folder to the remote search path if it's not already there
                remoteDirPath = (descriptorDir + "/" + remoteDirPath).replace(/\/+/g, '/');
            }

            const localTargetDir = path.join(pluginsDir, localDir);
            
            // Create the local directory inside "plugins" if it doesn't exist
            if (!fs.existsSync(localTargetDir)) {
                fs.mkdirSync(localTargetDir, { recursive: true });
                logInfo(`[Updater] Created local directory: ${localTargetDir}`);
            }
            
            logInfo(`[Updater] Starting recursive download for ${remoteDirPath}...`);
            const files = await downloadRecursive(owner, repo, branch, remoteDirPath, localTargetDir);
            downloadedList = downloadedList.concat(files);
        }

        // Step 4: Compare lists and save the metadata to new_data.json
        const notDownloadedList = allRepoFiles.filter(f => !downloadedList.includes(f));
        
        const overrides = loadOverrides();
        overrides[pluginName] = { 
            ...(overrides[pluginName] || {}),
            downloadedFiles: downloadedList,
            notDownloadedFiles: notDownloadedList
        };
        saveOverrides(overrides);

        // Return the summary of changes to the frontend
        res.json({ ok: true, files: downloadedList, notDownloadedFiles: notDownloadedList });
    } catch (e) {
        // Log the failure and return a 500 error
        logError(`[Updater] Update failed for ${pluginName}:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Endpoint to list contents of a directory within the plugins folder
 */
endpointsRouter.get('/plugins/Updater/list-dir', (req, res) => {
    const relativePath = req.query.path || '';
    const root = req.query.root;
    const baseDir = root === 'configs' ? configsDir : pluginsDir;
    const absolutePath = path.resolve(baseDir, relativePath);
    
    // Security: check that the path is inside the allowed folder
    if (!absolutePath.startsWith(baseDir)) {
        return res.status(403).send('Access denied');
    }

    try {
        if (!fs.existsSync(absolutePath)) return res.json([]);
        const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
        const list = entries.map(entry => ({
            name: entry.name,
            isDir: entry.isDirectory()
        }));
        res.json(list);
    } catch (e) {
        logError(`[Updater] Error listing directory ${relativePath}:`, e);
        res.status(500).send('Error reading directory');
    }
});

/**
 * Endpoint to save content to a file within the plugins folder
 */
endpointsRouter.post('/plugins/Updater/save-file', express.json(), (req, res) => {
    const { fileName, content, root } = req.body;
    if (!fileName || content === undefined) return res.status(400).send('Missing fileName or content');

    const baseDir = root === 'configs' ? configsDir : pluginsDir;
    const filePath = path.resolve(baseDir, fileName);

    // Security: check that the file is inside the allowed folder
    const relative = path.relative(baseDir, filePath);
    const isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);

    if (!isSafe || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        logError(`[${pluginName}] Access denied or file not found for saving: ${filePath} (base: ${baseDir})`);
        return res.status(403).send('Access denied or file not found');
    }

    try {
        fs.writeFileSync(filePath, content, 'utf8');
        logInfo(`[${pluginName}] File saved: ${filePath}`);
        res.json({ ok: true });
    } catch (e) {
        logError(`[${pluginName}] Error saving file ${filePath}:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Endpoint to delete a file within the plugins folder
 */
endpointsRouter.post('/plugins/Updater/delete-file', express.json(), (req, res) => {
    const { fileName, root } = req.body;
    if (!fileName) return res.status(400).send('Missing fileName');

    const baseDir = root === 'configs' ? configsDir : pluginsDir;
    const filePath = path.resolve(baseDir, fileName);

    // Security: check that the file is inside the allowed folder
    const relative = path.relative(baseDir, filePath);
    const isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);

    if (!isSafe || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        logError(`[${pluginName}] Access denied or file not found for deletion: ${filePath}`);
        return res.status(403).send('Access denied or file not found');
    }

    try {
        fs.unlinkSync(filePath);
        logInfo(`[${pluginName}] File deleted: ${filePath}`);
        res.json({ ok: true });
    } catch (e) {
        logError(`[${pluginName}] Error deleting file ${filePath}:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});


/**
 * Endpoint to read file content.
 * Security: ensures the file is inside the allowed folder (plugins or configs).
 */
endpointsRouter.get('/plugins/Updater/read-file', (req, res) => {
    const { fileName, root } = req.query;
    if (!fileName) return res.status(400).send('Missing fileName');
    
    const baseDir = root === 'configs' ? configsDir : pluginsDir;
    const filePath = path.resolve(baseDir, fileName);
    
    logInfo(`[Updater] Read request for: ${fileName} (Root: ${root || 'plugins'})`);

    // Security: check that the file is inside the allowed folder using relative path
    const relative = path.relative(baseDir, filePath);
    const isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);

    if (!isSafe || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        logError(`[Updater] Read access denied or file not found: ${filePath}. Safe check: ${isSafe}`);
        return res.status(403).send('Access denied or file not found');
    }

    try {
        const content = fs.readFileSync(filePath, 'utf8');
        res.send(content);
    } catch (e) {
        res.status(500).send('Error reading file');
    }
});

/**
 * Endpoint to delete a plugin from the server
 */
endpointsRouter.post('/plugins/Updater/delete-plugin', express.json(), (req, res) => {
    const { pluginName, fileName, localDir } = req.body;
    try {
        logInfo(`[Updater] Request to delete plugin: ${pluginName}`);

        // Step 1: Remove the main descriptor file (e.g., /plugins/PluginName.js)
        if (fileName) {
            const filePath = path.join(pluginsDir, fileName);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logInfo(`[Updater] Deleted descriptor: ${filePath}`);
            }
        }

        // Step 2: Remove the local plugin directory (e.g., /plugins/PluginFolder/)
        // Safety check: ensure localDir is not empty or pointing to restricted paths
        if (localDir && localDir !== "" && localDir !== "." && localDir !== "..") {
            const dirPath = path.join(pluginsDir, localDir);
            if (fs.existsSync(dirPath)) {
                fs.rmSync(dirPath, { recursive: true, force: true });
                logInfo(`[Updater] Deleted directory: ${dirPath}`);
            }
        }

        // Step 3: Remove the plugin's entry from plugins_data.json
        const overrides = loadOverrides();
        if (overrides[pluginName]) {
            delete overrides[pluginName];
            saveOverrides(overrides); // This will save the modified overrides (without the deleted plugin) to plugins_data.json
            logInfo(`[Updater] Removed entry for ${pluginName} from plugins_data.json`);
        }

        // Return success confirmation to the client
        res.json({ ok: true });
    } catch (e) {
        // Handle any file system or permission errors
        logError(`[Updater] Deletion failed for ${pluginName}:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Endpoint to list all installed plugins. Automatically discovers missing metadata if a repo URL is known.
 */
endpointsRouter.get('/plugins/Updater/list', async (req, res) => {
    try {
        logInfo(`[${pluginName}] Scanning directory: ${pluginsDir}`);
        const files = fs.readdirSync(pluginsDir);
        const pluginList = [];
        
        // Carichiamo i dati per gestire la priorità: Override > Code > repo_data
        const dynamicData = readJsonFile(overridesPath);
        const rawStatic = readJsonFile(repoDataPath);
        const staticData = {};
        for (const [n, v] of Object.entries(rawStatic)) {
            staticData[n] = typeof v === 'string' ? { repoUrl: v } : v;
        }
        const overrides = loadOverrides(); 
        let needsSave = false;

        for (const file of files) {
            // Search for .js files acting as descriptors (e.g., FavStations.js, Updater.js)
            if (file.endsWith('.js')) {
                const filePath = path.join(pluginsDir, file);
                // Exclude system files or scripts that are clearly frontend only
                if (fs.statSync(filePath).isFile() && file !== 'index.js' && !file.includes('.frontend.')) {
                    try { // Clear require cache to read any live changes
                        // Clear require cache to read any live changes
                        const resolvedPath = require.resolve(filePath);
                        delete require.cache[resolvedPath]; // Calculate default local directory (where the frontend resides)
                        const pluginModule = require(filePath);
                        if (pluginModule && pluginModule.pluginConfig) {
                            const config = pluginModule.pluginConfig;
                            const name = config.name;
                            const dyn = dynamicData[name] || {};
                            const stat = staticData[name] || {};

                            // Logica richiesta: se non c'è nel config, guarda in repo_data. dyn ha sempre priorità (manuale).
                            let repoUrl = (dyn && dyn.repoUrl) ? dyn.repoUrl : (config.repoUrl || stat.repoUrl);

                            // Automazione richiesta: se abbiamo il repo ma mancano i dettagli (fileUrl/localDir), ricava da GitHub
                            if (repoUrl && (!dyn.fileUrl || dyn.localDir === undefined)) {
                                logInfo(`[${pluginName}] Attempting auto-discovery for ${name} at ${repoUrl}`);
                                const discovered = await discoverMetadataFromRepo(repoUrl);
                                if (discovered) {
                                    logInfo(`[${pluginName}] Discovered metadata for ${name}:`, discovered);
                                    dynamicData[name] = { ...dyn, ...discovered, repoUrl };
                                    needsSave = true;
                                    // Aggiorna l'oggetto locale per la risposta immediata
                                    Object.assign(dyn, discovered);
                                    repoUrl = dyn.repoUrl;
                                }
                            }

                            // Calculate default local directory (where the frontend resides)
                            let defaultLocalDir = "";
                            if (config.frontEndPath) {
                                defaultLocalDir = path.dirname(config.frontEndPath).replace(/\\/g, '/');
                                if (defaultLocalDir === '.') defaultLocalDir = "";
                            }

                            pluginList.push({
                                ...config,
                                fileName: file,
                                fullPath: filePath,
                                ...dyn,
                                repoUrl: repoUrl,
                                localDir: dyn.localDir !== undefined ? dyn.localDir : (config.localDir || defaultLocalDir)
                            });
//                            logInfo(`[${pluginName}] Plugin metadata loaded for: ${pluginModule.pluginConfig.name}`);
                        } // Skip files that are not valid modules or don't contain pluginConfig
                    } catch (err) {
                        // Skip files that are not valid modules or don't contain pluginConfig
                        // logError(`[${pluginName}] Skipping ${file}: ${err.message}`);
                    }
                }
            }
        }

        if (needsSave) saveOverrides(dynamicData);

        // Add plugins defined in plugins_data.json that were not found physically
        Object.keys(overrides).forEach(name => {
            const alreadyInList = pluginList.find(p => p.name === name);
            if (!alreadyInList) {
                const ov = overrides[name];
                const fileName = (ov.fileUrl ? ov.fileUrl.split('/').pop() : name.replace(/\s+/g, '') + '.js');
                pluginList.push({
                    name: name,
                    version: '0.0.0',
                    author: 'Unknown',
                    fileName: fileName,
                    fullPath: path.join(pluginsDir, fileName),
                    ...ov,
                    isNew: true
                });
            }
        });

        logInfo(`[${pluginName}] Total plugins found: ${pluginList.length}`);
        res.json(pluginList);
    } catch (e) {
        logError(`[${pluginName}] Failed to read plugins directory:`, e);
        res.status(500).json([]);
    }
});

logInfo(`[${pluginName}] Backend initialized. Scanning directory: ${pluginsDir}`);
