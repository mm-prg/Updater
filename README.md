# Updater Plugin for FM-DX Webserver

The **Updater** plugin is a powerful management tool designed for the [FM-DX Webserver](https://github.com/NoobishSVK/fm-dx-webserver). It provides a centralized interface to track, update, and install plugins directly from GitHub.

## Features

- **Automated Version Checking**: Automatically scans GitHub to detect if newer versions of your installed plugins are available.
- **One-Click Updates**: Download and install the latest versions of plugins, including recursive updates for associated folders and subdirectories.
- **Plugin Discovery & Installation**: Add new plugins by simply providing a GitHub repository URL. The updater automatically identifies descriptor files and required folder structures.
- **Inventory Overview**: A sortable table showing all installed plugins, current versions, authors, and real-time status.
- **Source Code Viewer**: Inspect local plugin descriptor files directly from the web interface.
- **Installation Path Verification**: View the full absolute path of installed plugins for easy debugging and manual configuration.
- **Update Tracking**: Remembers and displays the specific files that were modified or added during the last update process.
- **Custom Overrides**: Manually adjust GitHub repository links, file paths, or local directory mappings for any plugin.

## Installation

1. Copy the plugin files into your webserver's directory structure.
2. Place the backend (`pluginUpdater_server.js`) and frontend (`pluginUpdater.js`) scripts into your `plugins/Updater/` folder.
3. Ensure the main descriptor (usually `Updater.js`) is in the root `plugins/` directory.
4. Restart your FM-DX Webserver.

## Usage

The plugin interface is accessible to administrators in two ways:

1. **Setup Page**: Navigate to the `/setup` section of your webserver. The **Plugin Inventory** table is integrated directly into the settings area.
2. **Main Interface**: If you are logged in as an administrator, a "cloud with downward arrow" icon appears in the plugin panel. Clicking it opens the inventory as a modal window over the main page.

### Actions

- **Update**: Highlighted in red when a newer version is available.
- **Reinstall**: Allows you to force-download all files for the current version if the installation is corrupted.
- **Edit**: Manually change the GitHub repository URL or the local target directory.
- **Delete**: Safely removes the plugin's descriptor file and its associated data directory from the server.
- **Version Click**: Click on a version number to view the source code, the full local path on the server, and the list of files downloaded in the last update.

## Technical Details

- **Backend**: A Node.js module using the GitHub REST API to perform recursive downloads and the `fs` module for secure file operations.
- **Frontend**: A vanilla JavaScript application that handles version comparison, UI rendering, and asynchronous communication with server endpoints.
- **Storage**: Custom configurations and metadata are stored in `new_data.json` within the plugin folder to ensure settings persist across updates.

## Author

Developed by **mm-prg**.

---

*Disclaimer: This plugin requires administrative privileges and an active internet connection to communicate with GitHub. It is recommended to backup your `plugins/` directory before performing major updates.*