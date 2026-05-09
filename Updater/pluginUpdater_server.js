/**
 * ************************************************
 * Updater Plugin for FM-DX Webserver (v. 0.0.2a)
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
// La directory dei plugin è quella superiore rispetto alla cartella di questo script
const pluginsDir = path.resolve(__dirname, '..');

// Percorso per i settaggi manuali (overrides di GitHub)
const overridesPath = path.join(__dirname, 'Updater.json');

logInfo(`[${pluginName}] Backend script is being loaded...`);

function loadOverrides() {
    try {
        if (!fs.existsSync(overridesPath)) return {};
        const raw = fs.readFileSync(overridesPath, 'utf8');
        return JSON.parse(raw || '{}');
    } catch (e) {
        logError(`[${pluginName}] Error loading overrides:`, e);
        return {};
    }
}

function saveOverrides(overrides) {
    try {
        fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2), 'utf8');
        return true;
    } catch (e) {
        logError(`[${pluginName}] Error saving overrides:`, e);
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
 * Helper per interrogare le API di GitHub
 */
const fetchGithubApi = (url) => new Promise((resolve, reject) => {
    const options = {
        headers: { 'User-Agent': 'FM-DX-Webserver-Updater' }
    };
    https.get(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            if (res.statusCode !== 200) return reject(new Error(`API Status ${res.statusCode}`));
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
    }).on('error', reject);
});

/**
 * Scarica ricorsivamente il contenuto di una cartella da GitHub tramite API
 */
async function downloadRecursive(owner, repo, branch, remotePath, localBaseDir) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${remotePath}?ref=${branch}`;
    const items = await fetchGithubApi(apiUrl);
    let downloadedFiles = [];

    if (!Array.isArray(items)) return downloadedFiles;

    for (const item of items) {
        const localPath = path.join(localBaseDir, item.name);
        
        if (item.type === 'file') {
            // Scarichiamo il file
            await download(item.download_url, localPath);
            logInfo(`[Updater] Downloaded: ${item.path}`);
            downloadedFiles.push(item.path);
        } else if (item.type === 'dir') {
            // Creiamo la directory e scendiamo ricorsivamente
            if (!fs.existsSync(localPath)) fs.mkdirSync(localPath, { recursive: true });
            const subFiles = await downloadRecursive(owner, repo, branch, item.path, localPath);
            downloadedFiles = downloadedFiles.concat(subFiles);
        }
    }
    return downloadedFiles;
}

/**
 * Endpoint per salvare i dati manuali di GitHub
 */
endpointsRouter.post('/plugins/Updater/save-override', express.json(), (req, res) => {
    try {
        const { pluginName: name, repoUrl, fileUrl, localDir } = req.body;

        // Crea la directory locale se definita e non esiste
        if (localDir && localDir !== "" && localDir !== "." && localDir !== "..") {
            const dirPath = path.join(pluginsDir, localDir);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                logInfo(`[${pluginName}] Created local directory for ${name}: ${localDir}`);
            }
        }

        const overrides = loadOverrides();
        overrides[name] = { repoUrl, fileUrl, localDir };
        if (saveOverrides(overrides)) res.json({ ok: true });
        else res.status(500).json({ ok: false });
    } catch (e) {
        logError(`[${pluginName}] Error in save-override:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Endpoint per eseguire l'aggiornamento di un plugin (scarica i file da GitHub)
 */
endpointsRouter.post('/plugins/Updater/update-plugin', express.json(), async (req, res) => {
    const { pluginName, rawBaseUrl, remoteDescriptorPath, localDescriptorName, frontEndPath, localDir } = req.body;
    try {
        logInfo(`[Updater] Updating plugin: ${pluginName} from ${rawBaseUrl}`);
        let downloadedList = [];

        // 1. Scarica il file descrittore principale in /plugins
        await download(`${rawBaseUrl}/${remoteDescriptorPath}`, path.join(pluginsDir, localDescriptorName));
        downloadedList.push(remoteDescriptorPath);

        // 2. Analisi URL per estrarre Owner, Repo e Branch per le API
        // rawBaseUrl es: https://raw.githubusercontent.com/mm-prg/FavStations/main
        const repoMatch = rawBaseUrl.match(/github(?:usercontent)?\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)/);
        if (repoMatch) {
            const [_, owner, repo, branch] = repoMatch;
            const relativeDir = localDir || (frontEndPath ? path.dirname(frontEndPath) : "");
            const remoteDirPath = relativeDir.replace(/\\/g, '/'); // GitHub vuole slash

            if (remoteDirPath && remoteDirPath !== ".") {
                const localTargetDir = path.join(pluginsDir, relativeDir);
                if (!fs.existsSync(localTargetDir)) fs.mkdirSync(localTargetDir, { recursive: true });
                
                logInfo(`[Updater] Starting recursive download for ${remoteDirPath}...`);
                const files = await downloadRecursive(owner, repo, branch, remoteDirPath, localTargetDir);
                downloadedList = downloadedList.concat(files);
            }
        }
        res.json({ ok: true, files: downloadedList });
    } catch (e) {
        logError(`[Updater] Update failed for ${pluginName}:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Endpoint per leggere il contenuto di un file descrittore locale
 */
endpointsRouter.get('/plugins/Updater/read-file', (req, res) => {
    const { fileName } = req.query;
    if (!fileName) return res.status(400).send('Missing fileName');
    
    const filePath = path.join(pluginsDir, fileName);
    
    // Sicurezza: controlla che il file sia all'interno della cartella plugins
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
 * Endpoint per eliminare un plugin
 */
endpointsRouter.post('/plugins/Updater/delete-plugin', express.json(), (req, res) => {
    const { pluginName, fileName, localDir } = req.body;
    try {
        logInfo(`[Updater] Request to delete plugin: ${pluginName}`);

        // 1. Rimuovi il file descrittore nella root di /plugins
        if (fileName) {
            const filePath = path.join(pluginsDir, fileName);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logInfo(`[Updater] Deleted descriptor: ${filePath}`);
            }
        }

        // 2. Rimuovi la directory locale (es. plugins/FavStations/)
        if (localDir && localDir !== "" && localDir !== "." && localDir !== "..") {
            const dirPath = path.join(pluginsDir, localDir);
            if (fs.existsSync(dirPath)) {
                fs.rmSync(dirPath, { recursive: true, force: true });
                logInfo(`[Updater] Deleted directory: ${dirPath}`);
            }
        }

        // 3. Rimuovi l'override da Updater.json
        const overrides = loadOverrides();
        if (overrides[pluginName]) {
            delete overrides[pluginName];
            saveOverrides(overrides);
        }

        res.json({ ok: true });
    } catch (e) {
        logError(`[Updater] Deletion failed for ${pluginName}:`, e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Endpoint per listare tutti i plugin installati leggendo i file .js nella root di /plugins
 */
endpointsRouter.get('/plugins/Updater/list', (req, res) => {
    try {
        logInfo(`[${pluginName}] Scanning directory: ${pluginsDir}`);
        const files = fs.readdirSync(pluginsDir);
        const pluginList = [];
        const overrides = loadOverrides();

        files.forEach(file => {
            // Cerchiamo i file .js che fungono da descrittori (es. FavStations.js, Updater.js)
            if (file.endsWith('.js')) {
                const filePath = path.join(pluginsDir, file);
                if (fs.statSync(filePath).isFile()) {
                    try {
//                    logInfo(`[${pluginName}] Reading descriptor: ${file}`);
                        // Puliamo la cache di require per leggere eventuali modifiche live
                        delete require.cache[require.resolve(filePath)];
                        const pluginModule = require(filePath);
                        if (pluginModule && pluginModule.pluginConfig) {
                            const config = pluginModule.pluginConfig;
                            const name = config.name;
                            const override = overrides[name] || {};

                            // Calcolo directory locale di default (dove risiede il frontend)
                            let defaultLocalDir = "";
                            if (config.frontEndPath) {
                                defaultLocalDir = path.dirname(config.frontEndPath).replace(/\\/g, '/');
                                if (defaultLocalDir === '.') defaultLocalDir = "";
                            }

                            pluginList.push({
                                ...config,
                                fileName: file,
                                ...override,
                                localDir: override.localDir !== undefined ? override.localDir : defaultLocalDir
                            });
//                            logInfo(`[${pluginName}] Plugin metadata loaded for: ${pluginModule.pluginConfig.name}`);
                        }
                    } catch (e) {
                        // Salta i file che non sono moduli validi o non contengono pluginConfig
                    }
                }
            }
        });

        // Aggiungiamo i plugin definiti negli override che non sono stati trovati fisicamente
        Object.keys(overrides).forEach(name => {
            const alreadyInList = pluginList.find(p => p.name === name);
            if (!alreadyInList) {
                const ov = overrides[name];
                pluginList.push({
                    name: name,
                    version: '0.0.0',
                    author: 'Unknown',
                    fileName: name.replace(/\s+/g, '') + '.js', // Nome file suggerito
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
