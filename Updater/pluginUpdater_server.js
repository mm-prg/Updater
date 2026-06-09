/**
 * ************************************************
 * Updater Plugin for FM-DX Webserver (v. 0.1.3b)
 * ************************************************
 */

// branch develop

"use strict";

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
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

// Global variable to track the last known GitHub API rate limit
let lastRateLimit = { remaining: '?', limit: '60', reset: 0 };

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
const fetchGithubApi = (url) => new Promise((resolve, reject) => {
    const options = {
        headers: { 'User-Agent': 'FM-DX-Webserver-Updater' }
    };
    https.get(url, options, (res) => {
        const remaining = res.headers['x-ratelimit-remaining'];
        const limit = res.headers['x-ratelimit-limit'];
        const reset = res.headers['x-ratelimit-reset'];
        if (remaining !== undefined) {
            lastRateLimit.remaining = remaining;
            lastRateLimit.limit = limit;
            lastRateLimit.reset = reset;
            logInfo(`[Updater] GitHub API Rate Limit: ${remaining}/${limit}, Reset: ${reset} (URL: ${url})`);
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            if (res.statusCode !== 200) return reject(new Error(`API Status ${res.statusCode}`));
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
    }).on('error', reject);
});

/**
 * Automatically discovers descriptor file and local directory from a GitHub repository.
 */
async function discoverMetadataFromRepo(repoUrl, preferredBranch = null) {
    // Supporta branch complessi con slash (es. /tree/feature/fix)
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/ \n?#]+)(?:\/tree\/([^ \n?#]+))?/);
    if (!match) return null;
    const [_, owner, repo, urlBranch] = match;

    try {
        // Fetch repository info to get the default branch
        const repoInfo = await fetchGithubApi(`https://api.github.com/repos/${owner}/${repo}`).catch(() => null);        
        let branch = urlBranch || preferredBranch || repoInfo?.default_branch || 'main';
        // If no specific branch was in the URL or preferred, and 'develop' exists, prefer 'develop'
        const branchesRes = await fetchGithubApi(`https://api.github.com/repos/${owner}/${repo}/branches`).catch(() => null);
        const branchList = Array.isArray(branchesRes) ? branchesRes.map(b => b.name) : [];
        if ((!urlBranch && !preferredBranch) && branchList.includes('develop')) branch = 'develop';

        // Pre-check rate limit using a lightweight head/get if possible, 
        // but here we just try to fetch and let fetchGithubApi log the remaining calls.
        const rateCheck = await fetchGithubApi(`https://api.github.com/rate_limit`).catch(() => null);
        if (rateCheck && rateCheck.resources && rateCheck.resources.core.remaining < 2) {
            logError(`[Updater] GitHub API limit too low (${rateCheck.resources.core.remaining}). Aborting discovery.`);
            return null;
        }

        let contents = await fetchGithubApi(`https://api.github.com/repos/${owner}/${repo}/contents/?ref=${branch}`);
        if (!Array.isArray(contents)) return null;

        const pluginsDirItem = contents.find(f => f.name.toLowerCase() === 'plugins' && f.type === 'dir');
        if (pluginsDirItem) {
            const pContents = await fetchGithubApi(`https://api.github.com/repos/${owner}/${repo}/contents/plugins?ref=${branch}`);
            if (Array.isArray(pContents)) contents = pContents;
        }

        const jsFiles = contents.filter(f => f.name.endsWith('.js') && f.name !== 'index.js' && !f.name.includes('.frontend.'));
        for (const file of jsFiles) {
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
            const text = await new Promise((resolve) => {
                const options = { headers: { 'User-Agent': 'FM-DX-Webserver-Updater', 'Cache-Control': 'no-cache' } };
                https.get(rawUrl, options, res => {
                    let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
                }).on('error', () => resolve(''));
            });

            if (text.includes('pluginConfig')) {
                const feMatch = text.match(/frontEndPath\s*:\s*['"]([^'"]+)['"]/);
                const localDir = (feMatch && feMatch[1].includes('/')) ? feMatch[1].split('/')[0] : "";
                return { fileUrl: file.path, localDir, branch };
            }
        }
    } catch (e) {
        logError(`[Updater] Auto-discovery failed for ${repoUrl}:`, e);
    }
    return null;
}

/**
 * Downloads files using the Tree data to avoid hitting GitHub API Rate Limits.
 * Uses raw.githubusercontent.com which is not rate-limited.
 */
async function downloadFromTree(owner, repo, branch, remoteDirPath, localBaseDir, treeItems) {
    let downloadedFiles = [];
    const folderPrefix = remoteDirPath.endsWith('/') ? remoteDirPath : remoteDirPath + '/';

    for (const item of treeItems) {
        if (item.type === 'blob' && item.path.startsWith(folderPrefix)) {
            const relativePath = item.path.substring(folderPrefix.length);
            const localPath = path.join(localBaseDir, relativePath);
            const localDir = path.dirname(localPath);

            if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`;
            await download(rawUrl, localPath);
            downloadedFiles.push(item.path);
        }
    }
    return downloadedFiles;
}

/**
 * Endpoint to retrieve the current API rate limit status
 */
endpointsRouter.get('/plugins/Updater/rate-limit', (req, res) => {
    res.json(lastRateLimit);
});

/**
 * Endpoint to fetch all branches of a repository
 */
endpointsRouter.get('/plugins/Updater/branches', async (req, res) => {
    const { repoUrl } = req.query;
    const match = repoUrl?.match(/github\.com\/([^/]+)\/([^/ \n?#]+)(?:\/tree\/([^ \n?#]+))?/);
    if (!match) return res.status(400).json({ error: "Invalid repository URL" });
    const [_, owner, repo] = match;

    try {
        const branches = await fetchGithubApi(`https://api.github.com/repos/${owner}/${repo}/branches`);
        res.json(Array.isArray(branches) ? branches.map(b => b.name) : []);
    } catch (e) {
        res.status(500).json({ error: "Could not fetch branches", details: e.message });
    }
});

/**
 * Endpoint di debug per visualizzare i file caricati nella cache di Node.js
 */
endpointsRouter.get('/plugins/Updater/debug-cache', (req, res) => {
    // Restituisce un array con i percorsi assoluti di tutti i moduli attualmente in cache
    const cacheKeys = Object.keys(require.cache);
    logInfo(`[${pluginName}] Debug: Ispezione cache richiesta. ${cacheKeys.length} file in cache.`);
    res.json(cacheKeys);
});

/**
 * Endpoint to retrieve global plugin options
 */
endpointsRouter.get('/plugins/Updater/settings', (req, res) => {
    const settings = readJsonFile(settingsPath);
    res.json(settings.showInPluginPanel !== undefined ? settings : { showInPluginPanel: true, showInHeader: true, showInSetup: true, advancedMode: false });
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
        const { pluginName: name, repoUrl, fileUrl, localDir, branch, downloadedFiles, notDownloadedFiles, localDescriptorName } = req.body; // Merge new data with existing ones to avoid losing information

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
            ...(branch !== undefined && { branch }),
            ...(downloadedFiles !== undefined && { downloadedFiles }),
            ...(notDownloadedFiles !== undefined && { notDownloadedFiles }),
            ...(localDescriptorName !== undefined && { localDescriptorName })
        };

        if (saveOverrides(overrides)) res.json({ ok: true, rateLimit: lastRateLimit });
        else res.status(500).json({ ok: false, rateLimit: lastRateLimit });
    } catch (e) {
        logError(`[${pluginName}] Error in save-override:`, e);
        res.status(500).json({ ok: false, error: e.message, rateLimit: lastRateLimit });
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
        
        // Cattura l'intero branch, anche se contiene slash
        const repoMatch = rawBaseUrl.match(/github(?:usercontent)?\.com\/([^\/]+)\/([^\/]+)\/(.+)/);
        if (!repoMatch) throw new Error("Invalid repository URL format");
        const [_, owner, repo, branch] = repoMatch;

        let downloadedList = [];
        let allRepoFiles = [];
        let treeItems = [];

        // Step 1: Download the list of all files in the repository (GitHub Tree API)
        try {
            const treeData = await fetchGithubApi(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
            if (treeData && treeData.tree) {
                allRepoFiles = treeData.tree
                    .filter(item => item.type === 'blob')
                    .map(item => item.path);
                treeItems = treeData.tree;
            }
        } catch (apiErr) {
            logError(`[Updater] Failed to fetch repo tree for ${pluginName}:`, apiErr);
        }

        // Step 2: Download the descriptor file and save it in the local "plugins" directory
        const descriptorUrl = `${rawBaseUrl}/${remoteDescriptorPath}`;
        const descriptorFileName = path.basename(localDescriptorName || remoteDescriptorPath);
        const descriptorDest = path.join(pluginsDir, descriptorFileName);
        const savedDescriptorName = descriptorFileName;

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
            logInfo(`[Updater] Downloading files from tree for ${remoteDirPath}...`);
            const files = await downloadFromTree(owner, repo, branch, remoteDirPath, localTargetDir, treeItems);
            downloadedList = downloadedList.concat(files);
        }

        // Step 4: Compare lists and save the metadata to new_data.json
        const notDownloadedList = allRepoFiles.filter(f => !downloadedList.includes(f));
        
        const overrides = loadOverrides();
        overrides[pluginName] = { 
            ...(overrides[pluginName] || {}),
            downloadedFiles: downloadedList,
            notDownloadedFiles: notDownloadedList,
            localDescriptorName: savedDescriptorName
        };
        saveOverrides(overrides);

        // Return the summary of changes to the frontend
        res.json({ ok: true, files: downloadedList, notDownloadedFiles: notDownloadedList, rateLimit: lastRateLimit });
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
 * Endpoint to execute shell commands on the server.
 * WARNING: This endpoint is highly sensitive and must be protected by strong authentication
 * and authorization checks to ensure only trusted administrators can access it.
 * The current implementation assumes the main server's middleware handles admin authentication.
 */
endpointsRouter.post('/plugins/Updater/terminal-command', express.json(), (req, res) => {
    // TODO: Implement robust server-side authentication and authorization checks here.
    // This is a critical security vulnerability if not properly protected.
    // Example: if (!req.user || !req.user.isAdmin) { return res.status(403).json({ ok: false, error: 'Unauthorized' }); }

    const { command } = req.body;
    if (!command) {
        // Restituisce la directory di lavoro corrente se non viene fornito alcun comando
        return res.json({ ok: true, stdout: '', stderr: '', cwd: process.cwd() });
    }

    logInfo(`[${pluginName}] Executing command: "${command}"`);
    exec(command, (error, stdout, stderr) => {
        if (error) {
            logError(`[${pluginName}] Command execution failed: ${error.message}`);
            return res.json({ ok: false, error: error.message, stdout, stderr, cwd: process.cwd() });
        }
        logInfo(`[${pluginName}] Command executed successfully.`);
        res.json({ ok: true, stdout, stderr, cwd: process.cwd() });
    });
});

/**
 * Endpoint to list all installed plugins. Automatically discovers missing metadata if a repo URL is known.
 */
endpointsRouter.get('/plugins/Updater/list', async (req, res) => {
    try {
        logInfo(`[${pluginName}] Scanning directory: ${pluginsDir}`);
        const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
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

        const processedLogicalNames = new Set();

        for (const entry of entries) {
            let filesToProcess = [];
            if (entry.isFile() && entry.name.endsWith('.js')) {
                filesToProcess.push(entry.name);
            } else if (entry.isDirectory()) {
                try {
                    const subFiles = fs.readdirSync(path.join(pluginsDir, entry.name));
                    for (const subFile of subFiles) {
                        if (subFile.endsWith('.js')) {
                            filesToProcess.push(path.join(entry.name, subFile).replace(/\\/g, '/'));
                        }
                    }
                } catch (e) {}
            }

            for (const file of filesToProcess) {
                const filePath = path.join(pluginsDir, file);
                const fileNameOnly = file.split(/[\\/]/).pop();

                // Skip only core server entry points and frontend-only files
                if (fileNameOnly !== 'index.js' && !fileNameOnly.includes('.frontend.') && fileNameOnly !== 'server.js') {
                    try { 
                        // Leggiamo il file come testo invece di usare require() per evitare crash con document/window
                        const text = fs.readFileSync(filePath, 'utf8');
                        
                        if (text.includes('pluginConfig')) {
                            const nameMatch = text.match(/name\s*:\s*['"]([^'"]+)['"]/);
                            const verMatch = text.match(/version\s*:\s*['"]([^'"]+)['"]/);
                            const authorMatch = text.match(/author\s*:\s*['"]([^'"]+)['"]/);
                            const feMatch = text.match(/frontEndPath\s*:\s*['"]([^'"]+)['"]/);
                            
                            if (!nameMatch) continue;

                            const pluginNameFromConfig = nameMatch[1].trim();
                            
                            // Avoid re-processing the same logical plugin if it has multiple files
                            if (processedLogicalNames.has(pluginNameFromConfig)) continue;

                            const config = {
                                name: pluginNameFromConfig,
                                logicalName: pluginNameFromConfig,
                                version: verMatch ? verMatch[1] : '0.0.0',
                                author: authorMatch ? authorMatch[1] : 'Unknown',
                                frontEndPath: feMatch ? feMatch[1] : ''
                            };
                            const localDescriptorName = path.basename(file); // e.g., FavStations.js

                            // Get dynamic override for this plugin name
                            const dynOverride = dynamicData[pluginNameFromConfig] || {};
                            const staticInfo = staticData[pluginNameFromConfig] || {};

                            // --- Prepare the "main" entry ---
                            let mainEntry = {
                                ...config, // Base info from local file
                                fileName: localDescriptorName, // Just the file name
                                fullPath: filePath,
                                localDescriptorName: localDescriptorName, // Store for matching
                                logicalName: pluginNameFromConfig,
                                // Default branch for this entry is 'main'
                                branch: 'main',
                                // Prioritize repoUrl/fileUrl/localDir from dynamicData if it's for 'main' or not branch-specific
                                repoUrl: dynOverride.repoUrl || staticInfo.repoUrl,
                                // Se l'override è per un branch diverso, la riga Main deve usare i default locali
                                fileUrl: (dynOverride.branch && dynOverride.branch !== 'main') ? config.frontEndPath : (dynOverride.fileUrl || config.frontEndPath),
                                localDir: (dynOverride.branch && dynOverride.branch !== 'main') ? (path.dirname(config.frontEndPath).replace(/\\/g, '/') || '') : (dynOverride.localDir || path.dirname(config.frontEndPath).replace(/\\/g, '/') || '')
                            };

                            processedLogicalNames.add(pluginNameFromConfig);

                            // Applica altri override solo se sono specifici per il main o generici
                            if (!dynOverride.branch || dynOverride.branch === 'main') {
                                Object.assign(mainEntry, dynOverride);
                                mainEntry.branch = 'main';
                            }
                            const originalBranch = dynOverride.branch;

                            // Auto-discovery for missing repo details for the main entry
                            if (mainEntry.repoUrl && (!mainEntry.branch || !mainEntry.fileUrl || mainEntry.localDir === undefined)) {
                                logInfo(`[${pluginName}] Attempting auto-discovery for ${mainEntry.name} (main) at ${mainEntry.repoUrl}`);
                                const discovered = await discoverMetadataFromRepo(mainEntry.repoUrl, 'main');
                                if (discovered) {
                                    logInfo(`[${pluginName}] Discovered metadata for ${mainEntry.name} (main):`, discovered);
                                    // Update dynamicData, preserving the original branch if it was specific
                                    const updateData = { ...discovered, repoUrl: mainEntry.repoUrl };
                                    if (originalBranch && originalBranch !== 'main') {
                                        delete updateData.branch; // Don't let main discovery overwrite develop
                                    }
                                    dynamicData[pluginNameFromConfig] = { ...dynamicData[pluginNameFromConfig], ...updateData };
                                    needsSave = true;
                                    // Apply discovered to mainEntry
                                    Object.assign(mainEntry, discovered);
                                }
                            }
                            pluginList.push(mainEntry); // Add main entry

                            // --- Prepare the "branch" entries if any specific branches are defined in overrides ---
                            for (const [ovrKey, ovrData] of Object.entries(dynamicData)) {
                                // Match any entry that belongs to this logical plugin and has a branch defined (not main)
                                const isBranchEntry = ovrData && typeof ovrData === 'object' && ovrData.branch && ovrData.branch !== 'main';
                                const belongsToThisPlugin = (ovrKey === pluginNameFromConfig) || 
                                                            (ovrKey.startsWith(`${pluginNameFromConfig} (`)) ||
                                                            (ovrData.logicalName === pluginNameFromConfig);

                                if (isBranchEntry && belongsToThisPlugin) {
                                    
                                    let branchEntry = {
                                        ...config, // Base info from local file
                                        name: (ovrKey === pluginNameFromConfig) ? `${pluginNameFromConfig} (${ovrData.branch})` : ovrKey,
                                        logicalName: pluginNameFromConfig,
                                        fileName: localDescriptorName, // Just the file name
                                        fullPath: filePath,
                                        localDescriptorName: localDescriptorName, // Store for matching
                                        ...ovrData, // All overrides apply to this branch entry
                                        branch: ovrData.branch, // Explicitly set branch
                                    };

                                    // Auto-discovery for missing repo details for the branch entry
                                    if (branchEntry.repoUrl && (!branchEntry.fileUrl || branchEntry.localDir === undefined)) {
                                        logInfo(`[${pluginName}] Attempting auto-discovery for ${branchEntry.name} at ${branchEntry.repoUrl}`);
                                        const discovered = await discoverMetadataFromRepo(branchEntry.repoUrl, branchEntry.branch);
                                        if (discovered) {
                                            logInfo(`[${pluginName}] Discovered metadata for ${branchEntry.name}:`, discovered);
                                            // Update dynamicData for this specific override key
                                            dynamicData[ovrKey] = { ...dynamicData[ovrKey], ...discovered, repoUrl: branchEntry.repoUrl };
                                            needsSave = true;
                                            // Apply discovered to branchEntry
                                            Object.assign(branchEntry, discovered);
                                        }
                                    }
                                    pluginList.push(branchEntry); // Add branch entry
                                }
                            }
                        } // Skip files that are not valid modules or don't contain pluginConfig
                    } catch (err) {
                        // Skip files that are not valid modules or don't contain pluginConfig
                        // logError(`[${pluginName}] Skipping ${file}: ${err.message}`);
                    }
                }
            }
        }

        if (needsSave) saveOverrides(dynamicData);

        logInfo(`[${pluginName}] Total logical plugins found: ${pluginList.length}`);
        res.json({ plugins: pluginList, rateLimit: lastRateLimit });
    } catch (e) {
        logError(`[${pluginName}] Failed to read plugins directory:`, e);
        res.status(500).json([]);
    }
});

logInfo(`[${pluginName}] Backend initialized. Scanning directory: ${pluginsDir}`);
