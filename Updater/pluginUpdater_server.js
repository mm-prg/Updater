/**
 * ************************************************
 * Updater Plugin for FM-DX Webserver (v. 0.0.6)
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
const overridesPath = path.join(__dirname, 'new_data.json'); // Dynamic file (new/modified)
const staticPath = path.join(__dirname, 'pl_data.json');    // Static file (known)
const settingsPath = path.join(configsDir, 'Updater.json'); // Global options file

// Ensure the settings directory exists
if (!fs.existsSync(configsDir)) fs.mkdirSync(configsDir, { recursive: true });
// Ensure the new_data.json file exists to avoid read/write errors
if (!fs.existsSync(overridesPath)) fs.writeFileSync(overridesPath, JSON.stringify({}, null, 2), 'utf8');

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
 * Loads plugin data: pl_data.json (known) + new_data.json (new/modified)
 */
function loadOverrides() { // Data in new_data.json overrides static data from pl_data.json
    const staticData = readJsonFile(staticPath);
    const dynamicData = readJsonFile(overridesPath);
    // Data in new_data.json overrides static data from pl_data.json
    return { ...staticData, ...dynamicData };
}

/**
 * Saves to new_data.json only data that differs from pl_data.json
 */
function saveOverrides(overrides) { // Store in new_data.json only if data differs from static ones in pl_data.json
    try {
        const staticData = readJsonFile(staticPath);
        const toSave = {};

        // Store in new_data.json only if data differs from static ones in pl_data.json
        for (const [name, data] of Object.entries(overrides)) {
            if (JSON.stringify(staticData[name]) !== JSON.stringify(data)) {
                toSave[name] = data;
            }
        }

        fs.writeFileSync(overridesPath, JSON.stringify(toSave, null, 2), 'utf8');
        return true;
    } catch (e) {
        logError(`[${pluginName}] Error saving overrides to new_data.json:`, e);
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
    res.json(settings.visibility ? settings : { visibility: 'both' });
});

/**
 * Endpoint to save global plugin options
 */
endpointsRouter.post('/plugins/Updater/settings', express.json(), (req, res) => {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(req.body, null, 2), 'utf8');
        res.json({ ok: true });
    } catch (e) {
        logError(`[${pluginName}] Error saving settings to ${settingsPath}:`, e); // Endpoint to save manual GitHub data
        res.status(500).json({ ok: false, error: e.message });
    } // Create local directory if defined and does not exist
});

/**
 * Endpoint to save manual GitHub data
 */
endpointsRouter.post('/plugins/Updater/save-override', express.json(), (req, res) => {
    try {
        const { pluginName: name, repoUrl, fileUrl, localDir, downloadedFiles, notDownloadedFiles } = req.body; // Merge new data with existing ones to avoid losing information

        // Create local directory if defined and does not exist
        if (localDir && localDir !== "" && localDir !== "." && localDir !== "..") {
            const dirPath = path.join(pluginsDir, localDir);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                logInfo(`[${pluginName}] Created local directory for ${name}: ${localDir}`);
            }
        }

        const overrides = loadOverrides(); // (e.g., when the client sends only the list of downloaded files after an update)
        
        // Merge new data with existing ones to avoid losing information
        // (e.g., when the client sends only the list of downloaded files after an update)
        overrides[name] = { 
            ...(overrides[name] || {}),
            ...(repoUrl !== undefined && { repoUrl }),
            ...(fileUrl !== undefined && { fileUrl }),
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
 * Endpoint to restart the server (requires Restart=always in the .service file)
 */
endpointsRouter.post('/plugins/Updater/restart-server', express.json(), (req, res) => {
    logInfo(`[${pluginName}] Server restart requested via UI...`);
    res.json({ ok: true, message: "Restarting server..." }); // Give time for the response to be sent before terminating the process

    // Give the response time to be sent before terminating the process
    setTimeout(() => {
        process.exit(0); 
    }, 1000);
});

/**
 * Endpoint to perform a plugin update (downloads files from GitHub)
 */
endpointsRouter.post('/plugins/Updater/update-plugin', express.json(), async (req, res) => {
    const { pluginName, rawBaseUrl, remoteDescriptorPath, localDescriptorName, frontEndPath, localDir } = req.body;
    try {
        logInfo(`[Updater] Updating plugin: ${pluginName} from ${rawBaseUrl}`);
        let downloadedList = [];
        let notDownloadedList = [];

        // 1. Download the main descriptor file to /plugins
        await download(`${rawBaseUrl}/${remoteDescriptorPath}`, path.join(pluginsDir, localDescriptorName));
        downloadedList.push(remoteDescriptorPath); // 2. URL analysis to extract Owner, Repo, and Branch for the API

        // 2. URL analysis to extract Owner, Repo, and Branch for the APIs
        // rawBaseUrl e.g.: https://raw.githubusercontent.com/mm-prg/FavStations/main
        const repoMatch = rawBaseUrl.match(/github(?:usercontent)?\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)/);
        if (repoMatch) {
            const [_, owner, repo, branch] = repoMatch;
            const relativeDir = localDir || (frontEndPath ? path.dirname(frontEndPath) : "");
            const remoteDirPath = relativeDir.replace(/\\/g, '/'); // GitHub expects slashes

            if (remoteDirPath && remoteDirPath !== ".") {
                const localTargetDir = path.join(pluginsDir, relativeDir);
                if (!fs.existsSync(localTargetDir)) fs.mkdirSync(localTargetDir, { recursive: true });
                
                logInfo(`[Updater] Starting recursive download for ${remoteDirPath}...`);
                const files = await downloadRecursive(owner, repo, branch, remoteDirPath, localTargetDir);
                downloadedList = downloadedList.concat(files);
            }

            // 3. Get all files in the repository to identify what was skipped
            try {
                const treeData = await fetchGithubApi(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
                if (treeData && treeData.tree) {
                    const allRepoFiles = treeData.tree
                        .filter(item => item.type === 'blob')
                        .map(item => item.path);
                    notDownloadedList = allRepoFiles.filter(f => !downloadedList.includes(f));
                }
            } catch (apiErr) {
                logError(`[Updater] Failed to fetch repo tree for ${pluginName}:`, apiErr);
            }
        }
        res.json({ ok: true, files: downloadedList, notDownloadedFiles: notDownloadedList });
    } catch (e) {
        logError(`[Updater] Update failed for ${pluginName}:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Endpoint to read local descriptor file content // Security: check that the file is inside the plugins folder
 */
endpointsRouter.get('/plugins/Updater/read-file', (req, res) => {
    const { fileName } = req.query;
    if (!fileName) return res.status(400).send('Missing fileName');
    
    const filePath = path.join(pluginsDir, fileName);
    
    // Security: check that the file is inside the plugins folder
    if (!filePath.startsWith(pluginsDir) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
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
 * Endpoint to delete a plugin // 1. Remove the descriptor file in the /plugins root
 */
endpointsRouter.post('/plugins/Updater/delete-plugin', express.json(), (req, res) => {
    const { pluginName, fileName, localDir } = req.body;
    try {
        logInfo(`[Updater] Request to delete plugin: ${pluginName}`);
        // 2. Remove the local directory (e.g., plugins/FavStations/)
        if (fileName) {
            const filePath = path.join(pluginsDir, fileName);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logInfo(`[Updater] Deleted descriptor: ${filePath}`);
            }
        }

        // 2. Remove the local directory (e.g., plugins/FavStations/)
        if (localDir && localDir !== "" && localDir !== "." && localDir !== "..") {
            const dirPath = path.join(pluginsDir, localDir);
            if (fs.existsSync(dirPath)) {
                fs.rmSync(dirPath, { recursive: true, force: true });
                logInfo(`[Updater] Deleted directory: ${dirPath}`);
            }
        }

        res.json({ ok: true });
    } catch (e) {
        logError(`[Updater] Deletion failed for ${pluginName}:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Endpoint to list all installed plugins by reading .js files in the /plugins root // Search for .js files acting as descriptors (e.g., FavStations.js, Updater.js)
 */
endpointsRouter.get('/plugins/Updater/list', (req, res) => {
    try {
        logInfo(`[${pluginName}] Scanning directory: ${pluginsDir}`);
        const files = fs.readdirSync(pluginsDir);
        const pluginList = [];
        const overrides = loadOverrides(); // Exclude system files or scripts that are clearly frontend only

        files.forEach(file => {
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
                            const override = overrides[name] || {};

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
                                ...override,
                                localDir: override.localDir !== undefined ? override.localDir : defaultLocalDir
                            });
//                            logInfo(`[${pluginName}] Plugin metadata loaded for: ${pluginModule.pluginConfig.name}`);
                        } // Skip files that are not valid modules or don't contain pluginConfig
                    } catch (err) {
                        // Skip files that are not valid modules or don't contain pluginConfig
                        // logError(`[${pluginName}] Skipping ${file}: ${err.message}`);
                    }
                }
            }
        });
        // Add plugins defined in overrides that were not found physically
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
