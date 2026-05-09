/**
 * ************************************************
 * Updater Plugin for FM-DX Webserver (v0.0.1)
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

const download = (url, dest) => new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
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
 * Endpoint per salvare i dati manuali di GitHub
 */
endpointsRouter.post('/plugins/Updater/save-override', express.json(), (req, res) => {
    const { pluginName: name, repoUrl, fileUrl, localDir } = req.body;
    const overrides = loadOverrides();
    overrides[name] = { repoUrl, fileUrl, localDir };
    if (saveOverrides(overrides)) res.json({ ok: true });
    else res.status(500).json({ ok: false });
});

/**
 * Endpoint per eseguire l'aggiornamento di un plugin (scarica i file da GitHub)
 */
endpointsRouter.post('/plugins/Updater/update-plugin', express.json(), async (req, res) => {
    const { pluginName, rawBaseUrl, remoteDescriptorPath, localDescriptorName, frontEndPath, localDir } = req.body;
    try {
        logInfo(`[Updater] Updating plugin: ${pluginName} from ${rawBaseUrl}`);

        // 1. Scarica il file descrittore principale in /plugins
        await download(`${rawBaseUrl}/${remoteDescriptorPath}`, path.join(pluginsDir, localDescriptorName));

        // 2. Scarica i file frontend e backend se frontEndPath è definito
        if (frontEndPath) {
            // Se localDir è fornito, usiamolo come base, altrimenti usiamo il dirname di frontEndPath
            let relativeDir = (localDir !== undefined && localDir !== null) ? localDir : path.dirname(frontEndPath);
            if (relativeDir === '.') relativeDir = "";
            
            const feDir = path.join(pluginsDir, relativeDir);
            const feFileName = path.basename(frontEndPath);
            const fePath = path.join(feDir, feFileName);
            const beFileName = feFileName.replace('.js', '_server.js');

            if (!fs.existsSync(feDir)) fs.mkdirSync(feDir, { recursive: true });

            // Download Frontend
            await download(`${rawBaseUrl}/${frontEndPath}`, fePath);

            // Download Backend (opzionale, basato sulla convenzione _server.js)
            const beRelPath = path.join(relativeDir, beFileName).replace(/\\/g, '/');
            const beUrl = `${rawBaseUrl}/${beRelPath}`;
            try {
                await download(beUrl, path.join(pluginsDir, beRelPath));
                logInfo(`[Updater] Backend file updated for ${pluginName}`);
            } catch (e) {
                logInfo(`[Updater] No server file found at ${beUrl}, skipping.`);
            }
        }

        res.json({ ok: true });
    } catch (e) {
        logError(`[Updater] Update failed for ${pluginName}:`, e);
        res.status(500).json({ ok: false, error: e.message });
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
                        logInfo(`[${pluginName}] Reading descriptor: ${file}`);
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
                            logInfo(`[${pluginName}] Plugin metadata loaded for: ${pluginModule.pluginConfig.name}`);
                        }
                    } catch (e) {
                        // Salta i file che non sono moduli validi o non contengono pluginConfig
                    }
                }
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
