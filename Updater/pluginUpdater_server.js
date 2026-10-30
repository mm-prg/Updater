/**
 * ************************************************
 * Updater Plugin for FM-DX Webserver (v. 0.3.7dev)
 * ************************************************
 */

"use strict";

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile } = require('child_process');
const express = require('express');
const https = require('https');
const endpointsRouter = require('../../server/endpoints');
const { logInfo, logError } = require('../../server/console');
const { serverConfig, configUpdate, configPath } = require('../../server/server_config');

const pluginName = "Updater";
// The script is located in main/plugins/Updater/
// To reach 'main/plugins/', we go up one level.
const pluginsDir = path.resolve(__dirname, '..');
// To reach 'main/', we go up two levels.
const serverRootDir = path.resolve(__dirname, '..', '..');
const configsDir = path.resolve(serverRootDir, 'plugins_configs');
const SERVER_COMMIT_SCAN_LIMIT = 100;
const SERVER_VERSION_LIMIT = 5;

// Track server start time to detect stale cache
const serverStartTime = Date.now();

// Path for manual settings (GitHub overrides)
const repoDataPath = path.join(__dirname, 'repo_data.json'); // Static file (known)
const overridesPath = path.join(__dirname, 'plugins_data.json'); // Dynamic file (new/modified)
const settingsPath = path.join(configsDir, 'Updater.json'); // Global options file
const fmDxRepositoryUrl = 'https://github.com/noobishsvk/fm-dx-webserver';

function runGit(args, cwd = serverRootDir) {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }
            resolve({ stdout: stdout || '', stderr: stderr || '' });
        });
    });
}

function runNpmInstall() {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    return new Promise((resolve, reject) => {
        execFile(npmCommand, ['install'], { cwd: serverRootDir, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }
            resolve({ stdout: stdout || '', stderr: stderr || '' });
        });
    });
}

function parseServerCommits(output) {
    return output.split(/\r?\n/).filter(Boolean).map(line => {
        const [sha, message, date] = line.split('\0');
        return { sha, message, date };
    });
}

async function readRecentServerCommits(cwd, revision = 'HEAD') {
    const { stdout } = await runGit(['log', `-${SERVER_COMMIT_SCAN_LIMIT}`, '--format=%H%x00%s%x00%cI', revision], cwd);
    const commits = parseServerCommits(stdout);
    const seenVersions = new Set();
    const latestVersions = [];

    for (const commit of commits) {
        if (seenVersions.size >= SERVER_VERSION_LIMIT) break;
        try {
            const { stdout: packageJson } = await runGit(['show', `${commit.sha}:package.json`], cwd);
            const version = JSON.parse(packageJson).version;
            if (!version || seenVersions.has(version)) continue;
            seenVersions.add(version);
            latestVersions.push({ ...commit, version });
        } catch {
            continue;
        }
    }

    return latestVersions;
}

function copyOfficialServerFiles(sourceDir, targetDir, isRoot = true) {
    const preservedRootEntries = new Set(['.git', 'node_modules', 'plugins', 'plugins_configs', 'config.json']);
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (isRoot && preservedRootEntries.has(entry.name)) continue;

        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            fs.mkdirSync(targetPath, { recursive: true });
            copyOfficialServerFiles(sourcePath, targetPath, false);
        } else if (entry.isFile()) {
            fs.copyFileSync(sourcePath, targetPath);
        }
    }
}

async function restoreFromOfficialClone() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fmdx-update-'));
    const cloneDir = path.join(tempRoot, 'source');
    try {
        await runGit(['clone', '--depth', '1', fmDxRepositoryUrl, cloneDir], tempRoot);
        copyOfficialServerFiles(cloneDir, serverRootDir);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

// Ensure the settings directory exists
if (!fs.existsSync(configsDir)) fs.mkdirSync(configsDir, { recursive: true });
// Ensure the plugins_data.json file exists to avoid read/write errors
if (!fs.existsSync(overridesPath)) fs.writeFileSync(overridesPath, JSON.stringify({}, null, 2), 'utf8');
if (!fs.existsSync(repoDataPath)) fs.writeFileSync(repoDataPath, JSON.stringify({}, null, 2), 'utf8');

// Increase payload limit for the core server endpoint /data_plugins
// to prevent 413 errors when saving a long list of plugins.
endpointsRouter.use('/data_plugins', express.json({ limit: '10mb' }));

//  logInfo(`[${pluginName}] Backend script is being loaded...`);

// Global variable to track the last known GitHub API rate limit
let lastRateLimit = { remaining: '?', limit: '60', reset: 0 };

// Global variable to track the terminal's current working directory
let terminalCwd = process.cwd();

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

function getConfiguredPluginPaths() {
    return Array.isArray(serverConfig.plugins)
        ? serverConfig.plugins.filter(pluginPath => typeof pluginPath === 'string')
        : [];
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
            fs.unlink(dest, () => { });
            return reject(new Error(`Status ${response.statusCode} for ${url}`));
        }
        response.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
    }).on('error', (err) => {
        fs.unlink(dest, () => { });
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
//            logInfo(`[Updater] GitHub API Rate Limit: ${remaining}/${limit}, Reset: ${reset} (URL: ${url})`);
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            if (res.statusCode !== 200) return reject(new Error(`API Status ${res.statusCode}`));
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
    }).on('error', reject);
});

const fetchRawText = (url) => new Promise((resolve, reject) => {
    const options = {
        headers: { 'User-Agent': 'FM-DX-Webserver-Updater', 'Cache-Control': 'no-cache' }
    };
    https.get(url, options, (res) => {
        if (res.statusCode !== 200) return resolve('');
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
    }).on('error', () => resolve(''));
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
        const branch = urlBranch || preferredBranch || 'main';

//    logInfo(`[${pluginName}] discoverMetadataFromRepo called for ${owner}/${repo} with branch=${branch}`);
        const treeData = await fetchGithubApi(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`).catch((err) => {
            logError(`[${pluginName}] GitHub tree request failed for ${owner}/${repo}@${branch}:`, err.message || err);
            return null;
        });
        if (!treeData || !Array.isArray(treeData.tree)) {
            logInfo(`[${pluginName}] GitHub tree response invalid or empty for ${owner}/${repo}@${branch}`);
            return null;
        }

        const hasPluginsDir = treeData.tree.some(item => item.type === 'tree' && item.path.toLowerCase() === 'plugins');
        const jsFiles = treeData.tree
            .filter(item => item.type === 'blob' && item.path.endsWith('.js') && !item.path.endsWith('index.js') && !item.path.includes('.frontend.') && !item.path.toLowerCase().includes('server'))
            .filter(item => !hasPluginsDir || item.path.split('/')[0].toLowerCase() === 'plugins');

        if (jsFiles.length === 0) {
            logInfo(`[${pluginName}] No candidate JS files found in repository ${owner}/${repo}@${branch}`);
            return null;
        }

        for (const file of jsFiles) {
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
            const text = await fetchRawText(rawUrl);
            if (!text) {
                logInfo(`[${pluginName}] Empty raw file response for ${rawUrl}`);
                continue;
            }
            if (text.includes('pluginConfig')) {
                const feMatch = text.match(/frontEndPath\s*:\s*['"]([^'"]+)['"]/);
                const localDir = (feMatch && feMatch[1].includes('/')) ? feMatch[1].split('/')[0] : "";
//                logInfo(`[${pluginName}] Found descriptor ${file.path} with pluginConfig in ${owner}/${repo}@${branch}`);
                return { fileUrl: file.path, localDir, branch };
            }
        }

        logInfo(`[${pluginName}] No pluginConfig descriptor found in ${owner}/${repo}@${branch}`);
    } catch (e) {
        logError(`[Updater] Auto-discovery failed for ${repoUrl}:`, e);
    }
    return null;
}

/**
 * Downloads files using the Tree data to avoid hitting GitHub API Rate Limits.
 * Uses raw.githubusercontent.com which is not rate-limited.
 */
async function downloadFromTree(owner, repo, branch, remoteDirPath, localBaseDir, treeItems, skipFiles = []) {
    let downloadedFiles = [];
    const folderPrefix = remoteDirPath.endsWith('/') ? remoteDirPath : remoteDirPath + '/';
    const skipList = Array.isArray(skipFiles)
        ? skipFiles.map(file => file.replace(/\\/g, '/').trim()).filter(Boolean)
        : [];

    for (const item of treeItems) {
        if (item.type === 'blob' && item.path.startsWith(folderPrefix)) {
            const relativePath = item.path.substring(folderPrefix.length);
            const normalizedPath = item.path.replace(/\\/g, '/');
            const normalizedRelative = relativePath.replace(/\\/g, '/');
            const fileName = path.basename(relativePath);

            const shouldSkip = skipList.some(skip => {
                const normalizedSkip = skip.replace(/\\/g, '/');
                return normalizedSkip === normalizedPath || normalizedSkip === normalizedRelative || normalizedSkip === fileName;
            });
            if (shouldSkip) continue;

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
 * Debug endpoint to view files loaded in the Node.js cache
 */
endpointsRouter.get('/plugins/Updater/debug-cache', (req, res) => {
    const cacheKeys = Object.keys(require.cache);
    const details = cacheKeys.map(filePath => {
        try {
            const stats = fs.statSync(filePath);
            return {
                path: filePath,
                isStale: stats.mtimeMs > serverStartTime,
                mtime: stats.mtime
            };
        } catch (e) {
            return { path: filePath, isStale: false, mtime: null };
        }
    });
    res.json({
        details,
        serverStartTime: new Date(serverStartTime).toLocaleString()
    });
});

/**
 * Helper to scan local files belonging to a specific plugin (descriptor + local directory)
 * Returns absolute paths.
 */
function getPluginLocalFilesAbsolute(fileName, localDir) {
    const fileList = [];

    // 1. Add the descriptor file if it exists
    if (fileName) {
        const filePath = path.join(pluginsDir, fileName);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            fileList.push(filePath);
        }
    }

    // 2. Scan the local directory recursively
    if (localDir && localDir !== "" && localDir !== "." && localDir !== "..") {
        const fullDir = path.resolve(pluginsDir, localDir);
        // Security check: ensure path is within plugins directory
        if (fullDir.startsWith(pluginsDir) && fs.existsSync(fullDir) && fs.statSync(fullDir).isDirectory()) {
            const scan = (dir) => {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const resPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        scan(resPath);
                    } else {
                        fileList.push(resPath);
                    }
                }
            };
            scan(fullDir);
        }
    }
    return [...new Set(fileList)];
}

/**
 * Helper function to get cache details for specific files.
 * Returns an array of objects with path, isStale, and mtime.
 */
function getCacheDetailsForFiles(filePaths) {
    const cacheDetails = [];
    const cacheKeys = Object.keys(require.cache);
    for (const filePath of filePaths) {
        // Find the exact match in require.cache
        const cachedPath = cacheKeys.find(key => key === filePath || path.resolve(key) === path.resolve(filePath));
        if (cachedPath) {
            try {
                const stats = fs.statSync(cachedPath);
                cacheDetails.push({
                    path: cachedPath,
                    isStale: stats.mtimeMs > serverStartTime,
                    mtime: stats.mtime
                });
            } catch (e) {
                // File might have been deleted from disk but still in cache
                cacheDetails.push({ path: cachedPath, isStale: false, mtime: null });
            }
        }
    }
    return cacheDetails;
}

/**
 * Endpoint to retrieve global plugin options
 */
endpointsRouter.get('/plugins/Updater/settings', express.json({ limit: '10mb' }), (req, res) => {
    const settings = readJsonFile(settingsPath);
    res.json(settings.showInPluginPanel !== undefined ? settings : { showInPluginPanel: true, showInHeader: true, showInSetup: true, showInServerDescription: true, advancedMode: true });
});

/**
 * Endpoint to save global plugin options
 */
endpointsRouter.post('/plugins/Updater/settings', express.json({ limit: '10mb' }), (req, res) => {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(req.body, null, 2), 'utf8');
        res.json({ ok: true });
    } catch (e) {
        logError(`[${pluginName}] Error saving settings to ${settingsPath}:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Endpoint to persist a plugin's enabled/disabled state.
 */
endpointsRouter.post('/plugins/Updater/plugin-state', express.json({ limit: '10mb' }), (req, res) => {
    try {
        if (!req.session?.isAdminAuthenticated) {
            return res.status(403).json({ ok: false, error: 'Administrator authentication is required' });
        }

        const frontEndPath = req.body?.frontEndPath;
        const enabled = req.body?.enabled;
        if (typeof frontEndPath !== 'string' || !frontEndPath.trim() || typeof enabled !== 'boolean') {
            return res.status(400).json({ ok: false, error: 'frontEndPath and enabled are required' });
        }

        const resolvedPath = path.resolve(pluginsDir, frontEndPath);
        const relativePath = path.relative(pluginsDir, resolvedPath);
        if (relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath) ||
            !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
            return res.status(400).json({ ok: false, error: 'Plugin frontend file was not found' });
        }

        const configuredPaths = getConfiguredPluginPaths();
        const updatedPaths = enabled
            ? Array.from(new Set([...configuredPaths, frontEndPath]))
            : configuredPaths.filter(pluginPath => pluginPath !== frontEndPath);

        configUpdate({ plugins: updatedPaths });
        const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!Array.isArray(savedConfig.plugins) ||
            savedConfig.plugins.length !== updatedPaths.length ||
            !savedConfig.plugins.every((pluginPath, index) => pluginPath === updatedPaths[index])) {
            throw new Error('The plugin configuration was not saved');
        }

        invalidateInstalledPluginListCache();
        res.json({ ok: true, restartRequired: true });
    } catch (e) {
        logError(`[${pluginName}] Error saving plugin state:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Endpoint to save manual GitHub data
 */
endpointsRouter.post('/plugins/Updater/save-override', express.json({ limit: '10mb' }), (req, res) => {
    try {
        const { pluginName: name, repoUrl, fileUrl, localDir, branch, downloadedFiles, notDownloadedFiles, localDescriptorName, skipFiles } = req.body; // Merge new data with existing ones to avoid losing information

        // If the plugin has a repository URL and is not yet in repo_data.json, add it
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
            ...(localDescriptorName !== undefined && { localDescriptorName }),
            ...(skipFiles !== undefined && { skipFiles })
        };

        if (saveOverrides(overrides)) {
            invalidateInstalledPluginListCache();
            res.json({ ok: true, rateLimit: lastRateLimit });
        }
        else res.status(500).json({ ok: false, rateLimit: lastRateLimit });
    } catch (e) {
        logError(`[${pluginName}] Error in save-override:`, e);
        res.status(500).json({ ok: false, error: e.message, rateLimit: lastRateLimit });
    }
});

/**
 * Endpoint to perform a plugin update (downloads files from GitHub)
 */
endpointsRouter.post('/plugins/Updater/update-plugin', express.json({ limit: '10mb' }), async (req, res) => {
    // Destructure required parameters from the request body
    const { pluginName, rawBaseUrl, remoteDescriptorPath, localDescriptorName, localDir } = req.body;
    try {
        logInfo(`[Updater] Updating plugin: ${pluginName} from ${rawBaseUrl}`);

        const overrides = loadOverrides();
        const pluginOverride = overrides[pluginName] || {};
        const skipFiles = Array.isArray(pluginOverride.skipFiles)
            ? pluginOverride.skipFiles
            : (typeof pluginOverride.skipFiles === 'string' ? [pluginOverride.skipFiles] : []);

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
        let skippedBySkipFiles = [];
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
            const files = await downloadFromTree(owner, repo, branch, remoteDirPath, localTargetDir, treeItems, skipFiles);
            downloadedList = downloadedList.concat(files);

            const folderPrefix = remoteDirPath.endsWith('/') ? remoteDirPath : remoteDirPath + '/';
            skippedBySkipFiles = treeItems
                .filter(item => item.type === 'blob' && item.path.startsWith(folderPrefix))
                .filter(item => {
                    const relativePath = item.path.substring(folderPrefix.length);
                    const normalizedPath = item.path.replace(/\\/g, '/');
                    const normalizedRelative = relativePath.replace(/\\/g, '/');
                    const fileName = path.basename(relativePath);
                    return skipFiles.some(skip => {
                        const normalizedSkip = skip.replace(/\\/g, '/');
                        return normalizedSkip === normalizedPath || normalizedSkip === normalizedRelative || normalizedSkip === fileName;
                    });
                })
                .map(item => item.path);

            skippedBySkipFiles = [...new Set(skippedBySkipFiles)];
        }

        // Step 4: Compare lists and save the metadata to new_data.json
        const notDownloadedList = allRepoFiles.filter(f => !downloadedList.includes(f));

        const updateOverrides = loadOverrides();
        updateOverrides[pluginName] = {
            ...(updateOverrides[pluginName] || {}),
            downloadedFiles: downloadedList,
            notDownloadedFiles: notDownloadedList,
            localDescriptorName: savedDescriptorName
        };
        saveOverrides(updateOverrides);

        // Return the summary of changes to the frontend
        logInfo(`[Updater] Plugin download completed for ${pluginName}. Files downloaded: ${downloadedList.length}, skippedBySkipFiles: ${skippedBySkipFiles.length}, notDownloadedFiles: ${notDownloadedList.length}`);
        invalidateInstalledPluginListCache();
        res.json({ ok: true, files: downloadedList, notDownloadedFiles: notDownloadedList, skippedBySkipFiles: skippedBySkipFiles || [], rateLimit: lastRateLimit });
    } catch (e) {
        // Log the failure and return a 500 error
        logError(`[Updater] Update failed for ${pluginName}:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

endpointsRouter.get('/plugins/Updater/plugin-commits', async (req, res) => {
    try {
        const repoUrl = typeof req.query.repoUrl === 'string' ? req.query.repoUrl : '';
        const descriptorPath = typeof req.query.descriptorPath === 'string' ? req.query.descriptorPath.replace(/\\/g, '/') : '';
        const repoBranch = typeof req.query.branch === 'string' ? req.query.branch.trim() : '';
        const parsedRepoUrl = new URL(repoUrl);
        const repoParts = parsedRepoUrl.pathname.split('/').filter(Boolean);

        if (parsedRepoUrl.protocol !== 'https:' || parsedRepoUrl.hostname !== 'github.com' || repoParts.length < 2) {
            return res.status(400).json({ ok: false, error: 'A valid GitHub repository URL is required.' });
        }

        const owner = repoParts[0];
        const repo = repoParts[1].replace(/\.git$/i, '');
        if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
            return res.status(400).json({ ok: false, error: 'Invalid GitHub repository name.' });
        }

        const urlBranch = repoParts[2] === 'tree' ? repoParts.slice(3).join('/') : '';
        const branch = repoBranch || urlBranch || 'main';
        if (branch.length > 200 || /[\r\n]/.test(branch)) {
            return res.status(400).json({ ok: false, error: 'Invalid repository branch.' });
        }
        if (!descriptorPath || descriptorPath.startsWith('/') || descriptorPath.split('/').some(part => part === '..')) {
            return res.status(400).json({ ok: false, error: 'A repository-relative plugin descriptor path is required.' });
        }

        const apiCommits = await fetchGithubApi(
            `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=100`
        );
        if (!Array.isArray(apiCommits)) throw new Error('GitHub returned an invalid commit list.');

        const encodedDescriptorPath = descriptorPath.split('/').map(encodeURIComponent).join('/');
        const seenVersions = new Set();
        const latestVersions = [];
        for (let index = 0; index < apiCommits.length && seenVersions.size < SERVER_VERSION_LIMIT; index += 10) {
            const batch = await Promise.all(apiCommits.slice(index, index + 10).map(async item => {
                const source = await fetchRawText(
                    `https://raw.githubusercontent.com/${owner}/${repo}/${item.sha}/${encodedDescriptorPath}`
                );
                const versionMatch = source.match(/(?:(?:const|var|let)\s+)?(?:pluginVersion|version)\s*[:=]\s*['"]([^'"]+)['"]/);
                return { item, version: versionMatch?.[1] || null };
            }));

            for (const { item, version } of batch) {
                if (!version || seenVersions.has(version)) continue;
                seenVersions.add(version);
                latestVersions.push({
                    sha: item.sha,
                    version,
                    message: (item.commit?.message || '').split(/\r?\n/, 1)[0],
                    date: item.commit?.author?.date || item.commit?.committer?.date || ''
                });
                if (seenVersions.size >= SERVER_VERSION_LIMIT) break;
            }
        }

        res.json({ ok: true, commits: latestVersions, rateLimit: lastRateLimit });
    } catch (e) {
        logError(`[${pluginName}] Unable to list plugin commits:`, e.message || e);
        res.status(500).json({ ok: false, error: e.message || 'Unable to retrieve plugin commits.', rateLimit: lastRateLimit });
    }
});

/**
 * Update the FM-DX Webserver checkout from its official GitHub repository.
 * Updates are fast-forward-only. A normal update requires a clean working
 * tree; a forced update discards local changes to tracked files and restores
 * them from the new official revision.
 */
endpointsRouter.post('/plugins/Updater/update-server', express.json({ limit: '10kb' }), async (req, res) => {
    try {
        const reinstall = req.body?.reinstall === true;
        const force = req.body?.force === true;
        if (!fs.existsSync(path.join(serverRootDir, '.git'))) {
            await restoreFromOfficialClone();
            await runNpmInstall();
            logInfo(`[${pluginName}] FM-DX Webserver files restored from a temporary official Git clone.`);
            return res.json({ ok: true, reinstalled: reinstall, updated: !reinstall, cloned: true });
        }

        const { stdout: remoteUrl } = await runGit(['remote', 'get-url', 'origin']);
        const normalizedRemote = remoteUrl.trim().replace(/\/$/, '').replace(/\.git$/i, '').toLowerCase();
        if (normalizedRemote !== fmDxRepositoryUrl) {
            return res.status(409).json({ ok: false, error: 'The Git origin is not the official FM-DX Webserver repository.' });
        }

        const { stdout: workingTree } = await runGit(['status', '--porcelain']);
        if (!reinstall && !force && workingTree.trim()) {
            return res.status(409).json({
                ok: false,
                error: `The server working tree has local changes. Commit, stash, or discard them before updating:\n${workingTree.trim()}`
            });
        }

        if (reinstall) {
            await runGit(['reset', '--hard', 'HEAD']);
            await runNpmInstall();
            logInfo(`[${pluginName}] FM-DX Webserver files reinstalled from the current Git revision.`);
            return res.json({ ok: true, reinstalled: true });
        }

        const { stdout: before } = await runGit(['rev-parse', 'HEAD']);
        await runGit(['fetch', '--quiet', 'origin', 'main']);
        if (force) {
            // Never let a forced tracked-file update silently remove an untracked
            // file that occupies a path introduced by the incoming revision.
            const [{ stdout: untracked }, { stdout: incomingPaths }] = await Promise.all([
                runGit(['ls-files', '--others', '--exclude-standard']),
                runGit(['diff', '--name-only', '--diff-filter=AM', 'HEAD', 'FETCH_HEAD'])
            ]);
            const untrackedPaths = untracked.split(/\r?\n/).filter(Boolean);
            const incoming = incomingPaths.split(/\r?\n/).filter(Boolean);
            const conflicts = untrackedPaths.filter(untrackedPath => incoming.some(incomingPath =>
                incomingPath === untrackedPath ||
                incomingPath.startsWith(`${untrackedPath}/`) ||
                untrackedPath.startsWith(`${incomingPath}/`)
            ));
            if (conflicts.length) {
                return res.status(409).json({
                    ok: false,
                    error: `Cannot force the update because it would overwrite untracked files:\n${conflicts.join('\n')}`
                });
            }
            // This deliberately affects tracked files only; untracked files are preserved.
            await runGit(['reset', '--hard', 'FETCH_HEAD']);
        } else {
            await runGit(['merge', '--ff-only', 'FETCH_HEAD']);
        }
        await runNpmInstall();
        const { stdout: after } = await runGit(['rev-parse', 'HEAD']);

        const updated = before.trim() !== after.trim();
        logInfo(`[${pluginName}] FM-DX Webserver ${updated ? 'updated' : 'is already up to date'}${force ? ' (local tracked changes overwritten)' : ''} (${after.trim()}).`);
        res.json({ ok: true, updated, forced: force });
    } catch (e) {
        const details = (e.stderr || e.message || 'Unknown Git error').trim();
        logError(`[${pluginName}] FM-DX Webserver update failed:`, details);
        res.status(500).json({ ok: false, error: details });
    }
});

endpointsRouter.get('/plugins/Updater/server-commits', async (req, res) => {
    let tempRoot;
    try {
        let repositoryDir = serverRootDir;
        const hasGitRepository = fs.existsSync(path.join(serverRootDir, '.git'));

        if (hasGitRepository) {
            const { stdout: remoteUrl } = await runGit(['remote', 'get-url', 'origin']);
            const normalizedRemote = remoteUrl.trim().replace(/\/$/, '').replace(/\.git$/i, '').toLowerCase();
            if (normalizedRemote !== fmDxRepositoryUrl) {
                return res.status(409).json({ ok: false, error: 'The Git origin is not the official FM-DX Webserver repository.' });
            }
            await runGit(['fetch', '--quiet', `--depth=${SERVER_COMMIT_SCAN_LIMIT}`, 'origin', 'main']);
            repositoryDir = 'FETCH_HEAD';
        } else {
            tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fmdx-commits-'));
            repositoryDir = path.join(tempRoot, 'source');
            await runGit(['clone', '--quiet', `--depth=${SERVER_COMMIT_SCAN_LIMIT}`, '--branch', 'main', fmDxRepositoryUrl, repositoryDir], tempRoot);
        }

        const commits = await readRecentServerCommits(hasGitRepository ? serverRootDir : repositoryDir, hasGitRepository ? repositoryDir : 'HEAD');
        res.json({ ok: true, commits });
    } catch (e) {
        const details = (e.stderr || e.message || 'Unknown Git error').trim();
        logError(`[${pluginName}] Unable to list FM-DX Webserver commits:`, details);
        res.status(500).json({ ok: false, error: details });
    } finally {
        if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

endpointsRouter.post('/plugins/Updater/install-server-commit', express.json({ limit: '10kb' }), async (req, res) => {
    let tempRoot;
    try {
        const commit = typeof req.body?.commit === 'string' ? req.body.commit.toLowerCase() : '';
        const force = req.body?.force === true;
        if (!/^[a-f0-9]{40}$/.test(commit)) {
            return res.status(400).json({ ok: false, error: 'A full 40-character commit SHA is required.' });
        }

        const hasGitRepository = fs.existsSync(path.join(serverRootDir, '.git'));
        let repositoryDir = serverRootDir;
        if (hasGitRepository) {
            const { stdout: remoteUrl } = await runGit(['remote', 'get-url', 'origin']);
            const normalizedRemote = remoteUrl.trim().replace(/\/$/, '').replace(/\.git$/i, '').toLowerCase();
            if (normalizedRemote !== fmDxRepositoryUrl) {
                return res.status(409).json({ ok: false, error: 'The Git origin is not the official FM-DX Webserver repository.' });
            }
            await runGit(['fetch', '--quiet', `--depth=${SERVER_COMMIT_SCAN_LIMIT}`, 'origin', 'main']);
            const commits = await readRecentServerCommits(serverRootDir, 'FETCH_HEAD');
            if (!commits.some(item => item.sha === commit)) {
                return res.status(400).json({ ok: false, error: 'The selected commit is not among the five most recent official versions.' });
            }

            const { stdout: workingTree } = await runGit(['status', '--porcelain']);
            if (workingTree.trim() && !force) {
                return res.status(409).json({ ok: false, error: 'The server working tree has local changes.' });
            }
            if (force) {
                const [{ stdout: untracked }, { stdout: changedPaths }] = await Promise.all([
                    runGit(['ls-files', '--others', '--exclude-standard']),
                    runGit(['diff', '--name-only', 'HEAD', commit])
                ]);
                const untrackedPaths = untracked.split(/\r?\n/).filter(Boolean);
                const incomingPaths = changedPaths.split(/\r?\n/).filter(Boolean);
                const conflicts = untrackedPaths.filter(untrackedPath => incomingPaths.some(incomingPath =>
                    incomingPath === untrackedPath ||
                    incomingPath.startsWith(`${untrackedPath}/`) ||
                    untrackedPath.startsWith(`${incomingPath}/`)
                ));
                if (conflicts.length) {
                    return res.status(409).json({
                        ok: false,
                        error: `Cannot install this version because it would overwrite untracked files:\n${conflicts.join('\n')}`
                    });
                }
            }

            await runGit(['reset', '--hard', commit]);
        } else {
            tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fmdx-commit-install-'));
            repositoryDir = path.join(tempRoot, 'source');
            await runGit(['clone', '--quiet', `--depth=${SERVER_COMMIT_SCAN_LIMIT}`, '--branch', 'main', fmDxRepositoryUrl, repositoryDir], tempRoot);
            const commits = await readRecentServerCommits(repositoryDir);
            if (!commits.some(item => item.sha === commit)) {
                return res.status(400).json({ ok: false, error: 'The selected commit is not among the five most recent official versions.' });
            }
            await runGit(['checkout', '--quiet', '--detach', commit], repositoryDir);
            copyOfficialServerFiles(repositoryDir, serverRootDir);
        }

        await runNpmInstall();
        logInfo(`[${pluginName}] FM-DX Webserver installed from commit ${commit}.`);
        res.json({ ok: true, commit });
    } catch (e) {
        const details = (e.stderr || e.message || 'Unknown Git error').trim();
        logError(`[${pluginName}] FM-DX Webserver historical install failed:`, details);
        res.status(500).json({ ok: false, error: details });
    } finally {
        if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

/**
 * Endpoint to list contents of a directory within the plugins folder
 */
endpointsRouter.get('/plugins/Updater/list-dir', (req, res) => {
    const relativePath = req.query.path || '';
    const root = req.query.root;
    let baseDir = pluginsDir;
    if (root === 'configs') baseDir = configsDir;
    else if (root === 'server') baseDir = serverRootDir;
    const absolutePath = path.resolve(baseDir, relativePath);

    // Security: check that the path is inside the allowed folder
    if (!absolutePath.startsWith(baseDir)) {
        return res.status(403).send('Access denied');
    }

    try {
        if (!fs.existsSync(absolutePath)) return res.json([]);
        const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
        const list = entries.map(entry => {
            try {
                const stats = fs.statSync(path.join(absolutePath, entry.name));
                return {
                    name: entry.name,
                    isDir: entry.isDirectory(),
                    mtime: stats.mtime
                };
            } catch (e) {
                return { name: entry.name, isDir: entry.isDirectory(), mtime: null };
            }
        });
        res.json(list);
    } catch (e) {
        logError(`[Updater] Error listing directory ${relativePath}:`, e);
        res.status(500).send('Error reading directory');
    }
});

/**
 * Endpoint to save content to a file within the plugins folder
 */
endpointsRouter.post('/plugins/Updater/save-file', express.json({ limit: '10mb' }), (req, res) => {
    const { fileName, content, root, append = false } = req.body;
    if (!fileName || content === undefined) return res.status(400).send('Missing fileName or content');

    let baseDir = pluginsDir;
    if (root === 'configs') baseDir = configsDir;
    else if (root === 'server') baseDir = serverRootDir;
    const filePath = path.resolve(baseDir, fileName);

    // Security: check that the file is inside the allowed folder
    const relative = path.relative(baseDir, filePath);
    const isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);

    if (!isSafe) {
        logError(`[${pluginName}] Access denied for saving: ${filePath} (base: ${baseDir})`);
        return res.status(403).send('Access denied');
    }

    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (append) {
            fs.appendFileSync(filePath, content, 'utf8');
            logInfo(`[${pluginName}] File appended: ${filePath}`);
        } else {
            fs.writeFileSync(filePath, content, 'utf8');
            logInfo(`[${pluginName}] File saved: ${filePath}`);
        }
        if (baseDir === pluginsDir) invalidateInstalledPluginListCache();
        res.json({ ok: true });
    } catch (e) {
        logError(`[${pluginName}] Error saving file ${filePath}:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Endpoint to scan local files belonging to a specific plugin (descriptor + local directory)
 */
endpointsRouter.get('/plugins/Updater/scan-local-files', (req, res) => { // This endpoint is called by the frontend's Explore modal
    const { fileName, localDir } = req.query;
    try {
        const absoluteFiles = getPluginLocalFilesAbsolute(fileName, localDir);
        // For the endpoint, we still want relative paths for the frontend to display
        const relativeFiles = absoluteFiles.map(f => path.relative(pluginsDir, f).replace(/\\/g, '/'));
        res.json(relativeFiles.sort());
    } catch (e) {
        res.status(500).json([]);
    }
});

/**
 * Endpoint to delete a file within the plugins folder
 */
endpointsRouter.post('/plugins/Updater/delete-file', express.json({ limit: '10mb' }), (req, res) => {
    const { fileName, root } = req.body;
    if (!fileName) return res.status(400).send('Missing fileName');

    let baseDir = pluginsDir;
    if (root === 'configs') baseDir = configsDir;
    else if (root === 'server') baseDir = serverRootDir;
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
        if (baseDir === pluginsDir) invalidateInstalledPluginListCache();
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

    let baseDir = pluginsDir;
    let filePath;
    let isSafe = false;

    if (root === 'cache') {
        // For cache items, fileName is an absolute path. 
        // We only allow reading if the file is currently loaded in Node.js cache.
        filePath = fileName;
        isSafe = require.cache[filePath] !== undefined;
        if (isSafe) {
            try {
                const cachedModule = require.cache[filePath];
                const stats = fs.statSync(filePath);
                return res.json({
                    content: JSON.stringify(cachedModule.exports, null, 2),
                    isStale: stats.mtimeMs > serverStartTime,
                    lastModified: stats.mtime,
                    serverStartedAt: new Date(serverStartTime).toLocaleString()
                });
            } catch (e) {
                return res.status(500).send('Error displaying cache exports: circular structure or complex object.');
            }
        }
    } else {
        if (root === 'configs') baseDir = configsDir;
        else if (root === 'server') baseDir = serverRootDir;
        filePath = path.resolve(baseDir, fileName);

        // Security: check that the file is inside the allowed folder using relative path
        const relative = path.relative(baseDir, filePath);
        isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    }

    //    logInfo(`[Updater] Read request for: ${fileName} (Root: ${root || 'plugins'})`);

    if (!isSafe || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        logError(`[Updater] Read access denied or file not found: ${filePath}. Safe check: ${isSafe}`);
        return res.status(403).send('Access denied or file not found');
    }

    try {
        let content = fs.readFileSync(filePath, 'utf8');

        // Se stiamo leggendo il log del server, mostriamo solo i messaggi dall'ultimo avvio
        if (root === 'server' && fileName === 'serverlog.txt') {
            const marker = '[INFO] Web server has started on address';
            const lastIdx = content.lastIndexOf(marker);
            if (lastIdx !== -1) {
                content = content.substring(lastIdx);
            }
        }
        res.send(content);
    } catch (e) {
        res.status(500).send('Error reading file');
    }
});

/**
 * Endpoint to delete a plugin from the server
 */
endpointsRouter.post('/plugins/Updater/delete-plugin', express.json({ limit: '10mb' }), (req, res) => {
    const { pluginName, logicalName, fileName, localDir } = req.body;
    try {
        logInfo(`[Updater] Request to delete plugin: ${pluginName}`);

        const overrides = loadOverrides();
        const pluginData = overrides[pluginName];
        const isSecondaryBranch = pluginData && pluginData.branch && pluginData.branch !== 'main';

        if (isSecondaryBranch) {
            logInfo(`[Updater] Skipping file deletion for secondary branch: "${pluginName}" (branch: ${pluginData.branch}). Only removing entry from plugins_data.json.`);
        } else {
            // Only delete files if it's the main entry or a standalone plugin
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
        }

        // Step 3: Remove the plugin's entry from plugins_data.json
        if (overrides[pluginName]) {
            delete overrides[pluginName];
            saveOverrides(overrides); // This will save the modified overrides (without the deleted plugin) to plugins_data.json
            logInfo(`[Updater] Removed entry for ${pluginName} from plugins_data.json`);
        }

        // Return success confirmation to the client
        invalidateInstalledPluginListCache();
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
endpointsRouter.post('/plugins/Updater/terminal-command', express.json({ limit: '10mb' }), (req, res) => {
    // TODO: Implement robust server-side authentication and authorization checks here.
    // This is a critical security vulnerability if not properly protected.
    // Example: if (!req.user || !req.user.isAdmin) { return res.status(403).json({ ok: false, error: 'Unauthorized' }); }

    const { command, sudoPassword: tempPassword } = req.body;
    const platform = os.platform(); // Rilevazione tramite modulo os

    if (!command) {
        return res.json({ ok: true, stdout: '', stderr: '', cwd: terminalCwd, platform });
    }

    const isWin = platform === "win32";
    const pwdCmd = isWin ? "cd" : "pwd";
    const shellSep = isWin ? "&" : "&&";

    let cmdToExec = `${command} ${shellSep} ${pwdCmd}`;

    // Gestione speciale per sudo su Linux/macOS (rileva sudo ovunque nel comando)
    if (!isWin && /\bsudo\b/.test(command)) {
        const settings = readJsonFile(settingsPath);
        const password = tempPassword || settings.sudoPassword;

        if (password) {
            // Eseguiamo l'intero comando tramite shell (bash -c) preceduto da sudo -S per gestire correttamente pipe e concatenazioni.
            // Usiamo -k per ignorare eventuali credenziali in cache e JSON.stringify per proteggere il comando da problemi di escape.
            cmdToExec = `echo "${password}" | sudo -S -k bash -c ${JSON.stringify(command + ' && ' + pwdCmd)}`;
        } else {
            // Se sudo è richiesto ma non abbiamo password, avvisiamo il frontend
            return res.json({ ok: false, needPassword: true, cwd: terminalCwd });
        }
    }

    logInfo(`[${pluginName}] Executing terminal command: "${command}" (Platform: ${process.platform})`);

    exec(cmdToExec, { cwd: terminalCwd }, (error, stdout, stderr) => {
        let output = stdout || '';
        let newCwd = terminalCwd;

        if (stdout) {
            const lines = stdout.trim().split(/\r?\n/);
            newCwd = lines.pop().trim(); // L'ultima riga è il risultato di pwd/cd
            output = lines.join('\n');   // The rest is the actual command output
        }

        terminalCwd = newCwd;

        if (error) {
            logError(`[${pluginName}] Command failed: ${error.message}`);
            return res.json({ ok: false, error: error.message, stdout: output, stderr, cwd: terminalCwd });
        }

        res.json({ ok: true, stdout: output, stderr, cwd: terminalCwd, platform });
    });
});

/**
 * Endpoint to list all installed plugins. Automatically discovers missing metadata if a repo URL is known.
 */
let installedPluginListCache = null;
let installedPluginListScan = null;

function invalidateInstalledPluginListCache() {
    installedPluginListCache = null;
    installedPluginListScan = null;
}

async function getInstalledPluginList() {
    if (installedPluginListCache) return installedPluginListCache;
    if (installedPluginListScan) return installedPluginListScan;

    let pendingScan;
    pendingScan = scanInstalledPlugins().then(result => {
        if (installedPluginListScan === pendingScan) installedPluginListCache = result;
        return result;
    }).finally(() => {
        if (installedPluginListScan === pendingScan) installedPluginListScan = null;
    });
    installedPluginListScan = pendingScan;
    return pendingScan;
}

async function scanInstalledPlugins() {
    try {
        logInfo(`[${pluginName}] Scanning directory: ${pluginsDir}`);
        const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
        const pluginList = [];

        // Load data to manage priority: Override > repo_data
        const rawDynamic = readJsonFile(overridesPath);
        const dynamicData = loadOverrides();
        const rawStatic = readJsonFile(repoDataPath);
        const staticData = {};
        for (const [n, v] of Object.entries(rawStatic)) {
            staticData[n] = typeof v === 'string' ? { repoUrl: v } : v;
        }

        const normalizeKey = (value) => String(value || '').toLowerCase().replace(/\s+/g, '').replace(/[-_\/\.]/g, '').replace(/[^a-z0-9]/g, '');
        const findStaticRepoUrl = (name, descriptor, localDir) => {
            const targets = [name, descriptor.replace(/\.js$/i, ''), localDir, descriptor, path.basename(descriptor, '.js')];
            const normalizedTargets = targets.filter(Boolean).map(normalizeKey);
            for (const [key, val] of Object.entries(rawStatic)) {
                const normalizedKey = normalizeKey(key);
                if (normalizedTargets.includes(normalizedKey) || normalizedTargets.some(t => normalizedKey.includes(t)) || normalizedKey.includes(normalizedTargets.join(''))) {
                    return typeof val === 'string' ? val : val.repoUrl;
                }
            }
            return null;
        };

        const overrides = loadOverrides();
        const configuredPluginPaths = getConfiguredPluginPaths();
        let needsSave = false;

        const processedLogicalNames = new Set();
        const localPluginsInfo = {}; // Stores local plugin data to associate them with branches

        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.js')) {
                const file = entry.name;
                const filePath = path.join(pluginsDir, file);
                const fileNameOnly = file.split(/[\\/]/).pop();

                // Skip only core server entry points and frontend-only files
                if (fileNameOnly !== 'index.js' && !fileNameOnly.includes('.frontend.') && fileNameOnly !== 'server.js') {
                    try {
                        // Read the file as text instead of using require() to avoid crashes with document/window
                        const text = fs.readFileSync(filePath, 'utf8');

                        if (text.includes('pluginConfig')) {
                            const nameMatch = text.match(/name\s*:\s*['"]([^'"]+)['"]/);
                            const verMatch = text.match(/version\s*:\s*['"]([^'"]+)['"]/);
                            const authorMatch = text.match(/author\s*:\s*['"]([^'"]+)['"]/);
                            const feMatch = text.match(/frontEndPath\s*:\s*['"]([^'"]+)['"]/);

                            if (!nameMatch) continue;

                            const pluginNameFromConfig = nameMatch[1].trim();
                            // logInfo(`[Updater] Local plugin detected: "${pluginNameFromConfig}" in file ${file}`);

                            // Avoid re-processing the same logical plugin if it has multiple files
                            if (processedLogicalNames.has(pluginNameFromConfig)) continue;

                            const localDescriptorName = path.basename(file); // e.g., FavStations.js
                            const fullConfig = {
                                name: pluginNameFromConfig,
                                logicalName: pluginNameFromConfig,
                                version: verMatch ? verMatch[1] : '0.0.0',
                                author: authorMatch ? authorMatch[1] : 'Unknown',
                                frontEndPath: feMatch ? feMatch[1] : '',
                                // Determine localDir from config.frontEndPath for cache check
                                localDir: (feMatch && feMatch[1].includes('/')) ? feMatch[1].split('/')[0] : ""
                            };

                            // Get all local files for this plugin (absolute paths)
                            const associatedLocalFiles = getPluginLocalFilesAbsolute(localDescriptorName, fullConfig.localDir);
                            // Check cache status for these files
                            const cacheStatus = getCacheDetailsForFiles(associatedLocalFiles);
                            const hasStaleFiles = cacheStatus.some(item => item.isStale);

                            // Get dynamic override for this plugin name
                            const dynOverride = dynamicData[pluginNameFromConfig] || {};
                            let staticInfo = staticData[pluginNameFromConfig] || {};
                            const fallbackRepoUrl = staticInfo.repoUrl ? null : findStaticRepoUrl(pluginNameFromConfig, localDescriptorName, fullConfig.localDir);
                            if (!staticInfo.repoUrl && fallbackRepoUrl) {
                                staticInfo = { repoUrl: fallbackRepoUrl };
                            }

                            // --- Prepare the "main" entry ---
                            let mainEntry = {
                                ...fullConfig, // Base info from local file
                                fileName: localDescriptorName, // Just the file name
                                fullPath: filePath,
                                localDescriptorName: localDescriptorName, // Store for matching
                                logicalName: pluginNameFromConfig,
                                isEnabled: configuredPluginPaths.includes(fullConfig.frontEndPath),
                                // Default branch for this entry is 'main'
                                branch: 'main',
                                hasStaleFiles: hasStaleFiles, // Add this new property
                                // Prioritize repoUrl/fileUrl/localDir from dynamicData if it's for 'main' or not branch-specific
                                repoUrl: dynOverride.repoUrl || staticInfo.repoUrl,
                                fileUrl: (dynOverride.branch && dynOverride.branch !== 'main') ? fullConfig.frontEndPath : (dynOverride.fileUrl || fullConfig.frontEndPath),
                                localDir: (dynOverride.branch && dynOverride.branch !== 'main') ? (path.dirname(fullConfig.frontEndPath).replace(/\\/g, '/') || '') : (dynOverride.localDir || path.dirname(fullConfig.frontEndPath).replace(/\\/g, '/') || '')
                            };

                            // Segnala se non viene trovato il repository GitHub per il plugin
                            if (!mainEntry.repoUrl || typeof mainEntry.repoUrl !== 'string' || !mainEntry.repoUrl.includes('github.com')) {
                                logError(`[${pluginName}] GitHub repository not found for plugin: "${pluginNameFromConfig}"`);
                            }

                            // Store local data for subsequent branch scanning
                            localPluginsInfo[pluginNameFromConfig] = { config: fullConfig, localDescriptorName, filePath };
                            processedLogicalNames.add(pluginNameFromConfig);

                            // Apply other overrides only if they are specific to main or generic
                            if (!dynOverride.branch || dynOverride.branch === 'main') {
                                Object.assign(mainEntry, dynOverride);
                                mainEntry.branch = 'main';
                            }
                            const originalBranch = dynOverride.branch;

                            const hasPluginOverride = Object.prototype.hasOwnProperty.call(rawDynamic, pluginNameFromConfig);
                            const shouldCachePlugin = mainEntry.repoUrl && !hasPluginOverride;

                            if (!mainEntry.repoUrl) {
//                                logInfo(`[${pluginName}] Skipping verification because plugin has no repoUrl: ${mainEntry.name}`);
                            } else if (hasPluginOverride) {
//                                logInfo(`[${pluginName}] Skipping verification because plugin already has an override entry: ${mainEntry.name}`);
                            }

                            if (shouldCachePlugin) {
//                                logInfo(`[${pluginName}] Verifying repository metadata before saving plugin data: ${mainEntry.name} (repoUrl=${mainEntry.repoUrl}, branch=${mainEntry.branch})`);
                                const discovered = await discoverMetadataFromRepo(mainEntry.repoUrl, mainEntry.branch);
                                if (discovered) {
//                                    logInfo(`[${pluginName}] Verified and discovered metadata for ${mainEntry.name}:`, discovered);
                                    const updateData = { repoUrl: mainEntry.repoUrl, ...discovered };
                                    if (originalBranch && originalBranch !== 'main') {
                                        delete updateData.branch; // Don't let main discovery overwrite develop
                                    }
                                    overrides[pluginNameFromConfig] = { ...overrides[pluginNameFromConfig], ...updateData };
                                    needsSave = true;
                                    Object.assign(mainEntry, discovered);
                                } else {
                                    logInfo(`[${pluginName}] Repository metadata verification failed for ${mainEntry.name}. Skipping save.`);
                                }
                            }

                            //                            logInfo(`[Updater] Added Main row for "${pluginNameFromConfig}" (branch: main)`);
                            pluginList.push(mainEntry); // Add main entry
                        } // Skip files that are not valid modules or don't contain pluginConfig
                    } catch (err) {
                        // Skip files that are not valid modules or don't contain pluginConfig
                        // logError(`[${pluginName}] Skipping ${file}: ${err.message}`);
                    }
                }
            }
        }

        // --- Phase 2: Scan plugins_data.json to add all secondary branches (branch != main) ---
        logInfo(`[Updater] Local plugins detected on disk: [${Object.keys(localPluginsInfo).join(', ')}]`);
        logInfo(`[Updater] Scanning plugins_data.json to add detected secondary branches...`);

        const jsonEntries = Object.entries(dynamicData);
//        logInfo(`[Updater] Number of entries found in JSON file: ${jsonEntries.length}`);

        for (const [ovrKey, ovrData] of jsonEntries) {
            //            logInfo(`[Updater] Analyzing JSON entry: "${ovrKey}"`);

            if (!ovrData || typeof ovrData !== 'object') {
                //              logInfo(`[Updater] -> Skipped entry "${ovrKey}": invalid data (null or not an object)`);
                continue;
            }

            if (!ovrData.branch || ovrData.branch === 'main') {
                //                logInfo(`[Updater] -> Skipped entry "${ovrKey}": missing branch or set to "main"`);
                continue;
            }

            // Identify the associated local plugin (e.g., from "FavStations (develop)" to "FavStations")
            let logicalName = ovrData.logicalName || ovrKey.split(' (')[0];
            let localInfo = localPluginsInfo[logicalName];

            // If no match found by name (e.g., "FavStations-dev0.2"), 
            // check if a local plugin exists that uses the same descriptor file saved in JSON
            if (!localInfo && ovrData.localDescriptorName) {
                const entryByFile = Object.entries(localPluginsInfo).find(([_, info]) => info.localDescriptorName === ovrData.localDescriptorName);
                if (entryByFile) {
                    logicalName = entryByFile[0];
                    localInfo = entryByFile[1];
                    //                    logInfo(`[Updater] -> Match found via file: "${ovrData.localDescriptorName}" associated with "${logicalName}"`);
                }
            }

            //            logInfo(`[Updater] -> Branch "${ovrData.branch}" detected for "${ovrKey}". Searching for local match for: "${logicalName}"`);

            // Add the branch only if the main plugin is installed locally
            if (localInfo) {
                logInfo(`[Updater] Plugin "${logicalName}" found locally. Adding branch row: "${ovrKey}"`);
                pluginList.push({
                    ...localInfo.config,
                    name: ovrKey,
                    logicalName: logicalName,
                    isEnabled: configuredPluginPaths.includes(localInfo.config.frontEndPath),
                    fileName: localInfo.localDescriptorName,
                    fullPath: localInfo.filePath,
                    localDescriptorName: localInfo.localDescriptorName,
                    ...ovrData, // GitHub data is taken directly from JSON
                    branch: ovrData.branch,
                    // Calculate hasStaleFiles for secondary branches
                    hasStaleFiles: (() => {
                        const secondaryBranchLocalFiles = getPluginLocalFilesAbsolute(
                            localInfo.localDescriptorName,
                            ovrData.localDir || (localInfo.config.frontEndPath ? path.dirname(localInfo.config.frontEndPath).replace(/\\/g, '/') : '')
                        );
                        return getCacheDetailsForFiles(secondaryBranchLocalFiles).some(item => item.isStale);
                    })()
                });
            } else {
                logInfo(`[Updater] -> KO: The main plugin "${logicalName}" was not detected locally. Verify that the "name" in pluginConfig of the .js file matches this string exactly.`);
            }
        }

        if (needsSave) saveOverrides(overrides);

        logInfo(`[${pluginName}] Total logical plugins found: ${pluginList.length}`);

        // Read server version from package.json in the root directory
        const serverPkgPath = path.join(serverRootDir, 'package.json');
        let serverVersion = '0.0.0';
        if (fs.existsSync(serverPkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(serverPkgPath, 'utf8'));
                serverVersion = pkg.version || '0.0.0';
            } catch (e) { }
        }

        return { plugins: pluginList, rateLimit: lastRateLimit, serverVersion };
    } catch (e) {
        logError(`[${pluginName}] Failed to read plugins directory:`, e);
        throw e;
    }
}

endpointsRouter.get('/plugins/Updater/list', async (req, res) => {
    try {
        res.json(await getInstalledPluginList());
    } catch {
        res.status(500).json([]);
    }
});

setImmediate(() => {
    getInstalledPluginList().catch(() => {});
});

// logInfo(`[${pluginName}] Backend initialized. Scanning directory: ${pluginsDir}`);
